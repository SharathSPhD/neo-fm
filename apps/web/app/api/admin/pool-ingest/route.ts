/**
 * POST /api/admin/pool-ingest (Bearer ADMIN_SECRET via checkAdminBearer): fills the station pool (public.pool_tracks).
 *
 *  multipart  file=<mp3>, meta=<json>   one render that exists only as a file (eval / quality / test renders).
 *             meta: { id, source, language, title?, genre?, raga?, mood?, theme?, tempo_bpm?, duration_seconds?,
 *                     lyrics? | lyrics_from? {batch, brief_id}, diction_u?, diction_verdict?, judge_overall?,
 *                     kind? "vocal" (default) | "instrumental", daypart?, energy? }
 *             Duration comes from the mp3 when meta omits it; energy and daypart are derived from mood, genre and theme when omitted.
 *  json       { mode: "backfill_duration", limit? }   fills duration_seconds on pool rows that have none.
 *             kind "instrumental" (migration 0100): language is forced to "zxx", there is no diction gate, and admission
 *             needs a Gemini listen that finds no voice in the audio.
 *             With `lyrics` the track is scored here (Gemini transcript, order-free gate); without it the caller must
 *             pass diction_u + diction_verdict from an earlier scoring run.
 *  json       { mode: "prod_jobs", owner_ids: [uuid, ...], limit? }   finished prod songs not yet in the pool (Indic languages only)
 *             that belong to the listed owners. owner_ids is required: real listeners' songs never enter the shared pool without
 *             their opt-in, so the caller must name the internal / test accounts explicitly. Scores the ones that have no diction verdict yet (one Gemini call each, `limit` per call, default 8).
 *
 * Admission is the diction gate: pool_tracks only accepts status=admitted at U >= 80 and verdict pass, and
 * admit_pool_track() is the only path in. Tracks that fail stay as `rejected` rows so they are not re-scored.
 */
import { enabledExpansionLanguages } from "@/lib/languages/registry";
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { auditDiction } from "../../../../lib/diction/gemini";
import { dictionVerdict, type DictionVerdict } from "../../../../lib/diction/gate";
import { scoreTranscriptUnordered } from "../../../../lib/diction";
import { singableLines } from "../../../../lib/lyrics/singable";
import { checkNoVocals } from "../../../../lib/pool/instrumental";
import { mirrorAdmittedTrack } from "../../../../lib/pool/mirror";
import { mp3DurationSeconds } from "../../../../lib/pool/mp3-duration";
import { headLines } from "../../../../lib/admin/lyrics-head";
import { tagMp3 } from "../../../../lib/audio/id3-tag";
import { siteBase } from "../../../../lib/social/site";
import { normalizeRaga } from "../../../../lib/pool/raga";
import { POOL_DAYPARTS, POOL_ENERGIES, POOL_MOODS, POOL_THEMES, deriveEnergyDaypart, normalizeLanguage, passesAdmission, passesInstrumentalAdmission, pickVocab, tagsFromDocument } from "../../../../lib/pool/tags";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;

const SOURCES = ["prod_job", "eval_render", "new_render"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAUNCH_INDIC = ["hi", "ta", "te", "kn", "bn"];
/** Languages whose finished prod songs may be pulled into the pool: the launch five plus enabled expansion waves. */
const indic = (): string[] => [...LAUNCH_INDIC, ...enabledExpansionLanguages(process.env.LANG_WAVES).map((l) => l.code as string)];
type Db = ReturnType<typeof serviceClient>;

interface FileMeta {
  id: string; source: (typeof SOURCES)[number]; language: string; title?: string; genre?: string; raga?: string;
  mood?: string[]; theme?: string[]; tempo_bpm?: number; duration_seconds?: number; lyrics?: string;
  /** Load the sung lyrics from a stored PCE eval row instead of sending them. */
  lyrics_from?: { batch: string; brief_id: string; max_lines?: number };
  /** Score with the diction gate and return the result without storing the file or a pool row (A/B runs). */
  score_only?: boolean;
  diction_u?: number; diction_verdict?: DictionVerdict; judge_overall?: number;
  kind?: "vocal" | "instrumental";
  /** Optional hand tags; when absent they are derived from mood, genre and theme. */
  energy?: string; daypart?: string[];
}

async function admit(db: Db, row: Record<string, unknown>, qa: { unorderedPct: number | null; verdict: DictionVerdict | null }, instrumentalOk?: boolean) {
  const { data: ins, error } = await db.from("pool_tracks").upsert({ ...row, diction_u: qa.unorderedPct, diction_verdict: qa.verdict }, { onConflict: "audio_path" }).select("id,status").single();
  if (error || !ins) return { ok: false as const, error: error?.message ?? "insert_failed" };
  const id = (ins as { id: string }).id;
  if ((ins as { status: string }).status === "admitted") {
    await mirrorAdmittedTrack(db, String(row.audio_path));
    return { ok: true as const, id, status: "admitted" };
  }
  if (!(instrumentalOk ?? passesAdmission(qa))) {
    await db.from("pool_tracks").update({ status: "rejected" }).eq("id", id).eq("status", "candidate");
    return { ok: true as const, id, status: "rejected" };
  }
  const { data: res, error: rpcErr } = await db.rpc("admit_pool_track", { p_id: id });
  if (rpcErr) return { ok: false as const, error: rpcErr.message };
  // New pool tracks go to R2 as they are admitted (best effort, no-op without R2 env) so the CDN never 404s on them.
  if (String(res) === "admitted") await mirrorAdmittedTrack(db, String(row.audio_path));
  return { ok: true as const, id, status: String(res) };
}

async function ingestFile(db: Db, form: FormData, geminiKey: string | undefined) {
  const file = form.get("file");
  const metaRaw = form.get("meta");
  if (!(file instanceof Blob) || typeof metaRaw !== "string") return NextResponse.json({ error: "file and meta required" }, { status: 400 });
  let meta: FileMeta;
  try { meta = JSON.parse(metaRaw) as FileMeta; } catch { return NextResponse.json({ error: "meta is not JSON" }, { status: 400 }); }
  const instrumental = meta.kind === "instrumental";
  const language = instrumental ? "zxx" : normalizeLanguage(meta.language ?? "");
  if (!meta.id || !/^[a-z0-9._-]{1,80}$/i.test(meta.id) || !language || !SOURCES.includes(meta.source)) return NextResponse.json({ error: "bad meta (id, language, source)" }, { status: 400 });

  const audio = new Uint8Array(await file.arrayBuffer());
  if (!meta.lyrics && meta.lyrics_from && /^[A-Za-z0-9]{1,12}$/.test(meta.lyrics_from.batch) && /^[a-z0-9-]{1,20}$/i.test(meta.lyrics_from.brief_id)) {
    const { data } = await db.from("eval_runs").select("lyrics").eq("batch", meta.lyrics_from.batch).eq("brief_id", meta.lyrics_from.brief_id).eq("arm", "pce").maybeSingle();
    meta.lyrics = (data as { lyrics?: string } | null)?.lyrics ?? undefined;
    // A 30 s clip sings only the opening lines, so the same cut that was rendered is what gets scored.
    if (meta.lyrics && Number.isFinite(meta.lyrics_from.max_lines)) meta.lyrics = headLines(meta.lyrics, Number(meta.lyrics_from.max_lines));
  }
  let qa: { unorderedPct: number | null; verdict: DictionVerdict | null } = { unorderedPct: meta.diction_u ?? null, verdict: meta.diction_verdict ?? null };
  let vocalsAbsent: boolean | null = null;
  if (instrumental) {
    if (!geminiKey) return NextResponse.json({ error: "no_gemini_key" }, { status: 503 });
    vocalsAbsent = (await checkNoVocals(audio, file.type || "audio/mpeg", geminiKey)).vocalsAbsent;
  } else if (meta.lyrics) {
    if (!geminiKey) return NextResponse.json({ error: "no_gemini_key" }, { status: 503 });
    const sung = singableLines(meta.lyrics).join("\n") || meta.lyrics;
    const scored = await auditDiction(sung, audio, file.type || "audio/mpeg", language, geminiKey);
    const gate = dictionVerdict(scored, scoreTranscriptUnordered(sung, scored.transcript));
    qa = { unorderedPct: gate.unorderedPct, verdict: gate.verdict };
  }

  if (meta.score_only) return NextResponse.json({ id: meta.id, ...qa, stored: false });
  const path = `pool/${meta.source}/${meta.id}.mp3`;
  const { error: upErr } = await db.storage.from("tracks").upload(path, tagMp3(audio, { site: siteBase() }), { contentType: file.type || "audio/mpeg", upsert: true });
  if (upErr) return NextResponse.json({ error: `upload: ${upErr.message}` }, { status: 502 });
  const mood = pickVocab(meta.mood ?? [], POOL_MOODS);
  const theme = pickVocab(meta.theme ?? [], POOL_THEMES);
  const raga = normalizeRaga(meta.raga);
  const derived = deriveEnergyDaypart({ mood, theme, genre: meta.genre ?? null, tempo_bpm: meta.tempo_bpm ?? null, raga });
  const dayparts = pickVocab(meta.daypart ?? [], POOL_DAYPARTS);
  const measured = mp3DurationSeconds(audio);
  const duration = meta.duration_seconds ?? (measured !== null ? Math.round(measured) : null);
  const r = await admit(db, {
    job_id: null, source: meta.source, audio_path: path, title: meta.title ?? null, duration_seconds: duration,
    language, genre: meta.genre ?? null, raga,
    mood, theme, tempo_bpm: meta.tempo_bpm ?? null,
    energy: (POOL_ENERGIES as readonly string[]).includes(meta.energy ?? "") ? meta.energy : derived.energy,
    daypart: dayparts.length ? dayparts : derived.daypart,
    judge_overall: meta.judge_overall ?? null,
    ...(instrumental ? { kind: "instrumental", vocals_absent: vocalsAbsent } : {}),
  }, qa, instrumental ? passesInstrumentalAdmission(vocalsAbsent) : undefined);
  return NextResponse.json({ id: meta.id, path, ...qa, ...(instrumental ? { vocals_absent: vocalsAbsent } : {}), ...r });
}

async function ingestProdJobs(db: Db, owners: string[], limit: number, geminiKey: string | undefined) {
  const { data: runs } = await db.from("agent_runs").select("job_id,audio_path,lyrics,diction_qa").not("audio_path", "is", null).limit(500);
  const { data: have } = await db.from("pool_tracks").select("audio_path");
  const taken = new Set(((have ?? []) as Array<{ audio_path: string }>).map((r) => r.audio_path));
  const todo = ((runs ?? []) as Array<{ job_id: string; audio_path: string; lyrics: string | null; diction_qa: { unorderedPct?: number; verdict?: DictionVerdict } | null }>).filter((r) => !taken.has(r.audio_path));
  const out: Array<Record<string, unknown>> = [];
  let scoredCount = 0;
  for (const r of todo) {
    const { data: jobs } = await db.from("jobs").select("user_id,status,moderation_status,taken_down_at,song_documents(title,document_json)").eq("id", r.job_id).limit(1);
    const j = (jobs ?? [])[0] as unknown as { user_id: string; status: string; moderation_status: string | null; taken_down_at: string | null; song_documents: { title: string | null; document_json: Parameters<typeof tagsFromDocument>[0] } | null } | undefined;
    if (!j || !owners.includes(j.user_id) || j.status !== "completed" || j.moderation_status !== "ok" || j.taken_down_at || !j.song_documents) continue;
    const tags = tagsFromDocument(j.song_documents.document_json);
    if (!tags || !indic().includes(tags.language)) continue;
    let qa = { unorderedPct: r.diction_qa?.unorderedPct ?? null, verdict: r.diction_qa?.verdict ?? null } as { unorderedPct: number | null; verdict: DictionVerdict | null };
    if (qa.verdict === null) {
      if (!geminiKey || !r.lyrics || scoredCount >= limit) { out.push({ job_id: r.job_id, skipped: !r.lyrics ? "no_lyrics" : "scoring_limit" }); continue; }
      scoredCount++;
      const { data: blob } = await db.storage.from("tracks").download(r.audio_path);
      if (!blob) { out.push({ job_id: r.job_id, skipped: "no_audio" }); continue; }
      const sung = singableLines(r.lyrics).join("\n") || r.lyrics;
      const scored = await auditDiction(sung, new Uint8Array(await blob.arrayBuffer()), blob.type || "audio/mpeg", tags.language, geminiKey);
      const gate = dictionVerdict(scored, scoreTranscriptUnordered(sung, scored.transcript));
      qa = { unorderedPct: gate.unorderedPct, verdict: gate.verdict };
    }
    const res = await admit(db, {
      job_id: r.job_id, source: "prod_job", audio_path: r.audio_path, title: j.song_documents.title,
      language: tags.language, genre: tags.genre, raga: tags.raga, mood: tags.mood, theme: tags.theme, tempo_bpm: tags.tempo_bpm,
    }, qa);
    out.push({ job_id: r.job_id, ...qa, ...res });
  }
  return NextResponse.json({ scored: scoredCount, results: out });
}

/** Sets duration_seconds on pool rows that have none, by reading the stored mp3. Never touches rows that already have one. */
async function backfillDuration(db: Db, limit: number) {
  const { data } = await db.from("pool_tracks").select("id,audio_path").is("duration_seconds", null).neq("status", "rejected").limit(limit);
  const out: Array<Record<string, unknown>> = [];
  for (const r of (data ?? []) as Array<{ id: string; audio_path: string }>) {
    const { data: blob } = await db.storage.from("tracks").download(r.audio_path);
    const secs = blob ? mp3DurationSeconds(new Uint8Array(await blob.arrayBuffer())) : null;
    if (secs === null) { out.push({ audio_path: r.audio_path, skipped: blob ? "unreadable" : "no_audio" }); continue; }
    const { error } = await db.from("pool_tracks").update({ duration_seconds: Math.round(secs) }).eq("id", r.id).is("duration_seconds", null);
    out.push({ audio_path: r.audio_path, duration_seconds: Math.round(secs), ...(error ? { error: error.message } : {}) });
  }
  return NextResponse.json({ updated: out.filter((o) => typeof o.duration_seconds === "number" && !o.error).length, results: out });
}

export async function POST(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = serviceClient();
  const geminiKey = process.env.GEMINI_API_KEY;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.startsWith("multipart/form-data")) return ingestFile(db, await req.formData(), geminiKey);
  const body = (await req.json().catch(() => ({}))) as { mode?: string; limit?: number; owner_ids?: unknown };
  if (body.mode === "prod_jobs") {
    const owners = Array.isArray(body.owner_ids) ? body.owner_ids.filter((x): x is string => typeof x === "string" && UUID.test(x)) : [];
    if (owners.length === 0) return NextResponse.json({ error: "owner_ids required: name the internal/test accounts whose songs may enter the shared pool" }, { status: 400 });
    return ingestProdJobs(db, owners, Math.min(Math.max(body.limit ?? 8, 1), 20), geminiKey);
  }
  if (body.mode === "backfill_duration") return backfillDuration(db, Math.min(Math.max(body.limit ?? 25, 1), 60));
  return NextResponse.json({ error: "send multipart (file, meta) or { mode: 'prod_jobs' | 'backfill_duration' }" }, { status: 400 });
}
