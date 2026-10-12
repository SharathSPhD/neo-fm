/**
 * Shared worker: advances Managed Agents runs. Called by the cron tick and, pull-style,
 * by the song poll route so a job moves as soon as its owner is watching it.
 */
import { anthropicClient, runStore, serviceClient, sessionApi, spendGuard } from "./adapters";
import { generateMusic } from "./lyria";
import { advance } from "./runner";
import { screenRequest } from "../safety";
import { mergeLyrics } from "./lyrics-merge";
import { auditDiction } from "../diction/gemini";
import { dictionHints } from "../diction";
import { mintEmbedToken } from "./embed-token";
import { agentIdFor, planForTier, type UserTier } from "./tiers";

class SafetyRefusal extends Error {}

export function isTransient(status: number | undefined, msg: string): boolean {
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  return /overloaded|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|network/i.test(msg);
}

const MAX_CLAIM = 3;
const LEASE_SECONDS = 280; // just under maxDuration (300s on Vercel Pro)

export type ProcessEnv = { environmentId: string; geminiKey: string };

/** Atomic per-job lease: one worker at a time; expires on its own if a function dies. */
export async function takeLease(db: ReturnType<typeof serviceClient>, jobId: string): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString();
  const { data } = await db
    .from("jobs")
    .update({ agent_lease_until: until })
    .eq("id", jobId)
    .or(`agent_lease_until.is.null,agent_lease_until.lt.${now.toISOString()}`)
    .select("id");
  return (data ?? []).length > 0;
}

export async function releaseLease(db: ReturnType<typeof serviceClient>, jobId: string) {
  await db.from("jobs").update({ agent_lease_until: null }).eq("id", jobId);
}

/** Advance the given jobs (or every active job when `onlyJobId` is omitted). */
export async function processJobs(env: ProcessEnv, onlyJobId?: string) {
  const { environmentId, geminiKey } = env;
  const db = serviceClient();
  const sessions = sessionApi();
  // Claim: queued -> processing is a conditional update, so two workers never take the same job.
  const { data: queued } = onlyJobId
    ? await db.from("jobs").select("id").eq("status", "queued").eq("id", onlyJobId)
    : await db.from("jobs").select("id").eq("status", "queued").order("created_at").limit(MAX_CLAIM);
  for (const j of queued ?? []) {
    await db.from("jobs").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", j.id).eq("status", "queued");
  }

  // Plain queries (no PostgREST embeds): embed resolution depends on the schema cache
  // and failed silently once; errors are surfaced instead of swallowed.
  const activeQuery = db.from("jobs").select("id,user_id,song_document_id,started_at").eq("status", "processing");
  const { data: active, error: activeErr } = await (onlyJobId ? activeQuery.eq("id", onlyJobId) : activeQuery);
  if (activeErr) throw new Error(`jobs_query_failed: ${activeErr.message}`);

  const results: Record<string, string> = {};
  const trace: string[] = [];
  // Vercel gives this route 60s; renders take ~30s each, so jobs run in small parallel batches, not one after another.
  const CONCURRENCY = 4;
  const work = (active ?? []) as { id: string; user_id: string; song_document_id: string; started_at?: string | null }[];
  const runJob = async (job: { id: string; user_id: string; song_document_id: string; started_at?: string | null }) => {
    if (!(await takeLease(db, job.id))) { results[job.id] = "busy"; return; }
    try {
      const [{ data: docRow, error: docErr }, { data: userRow }] = await Promise.all([
        db.from("song_documents").select("language,style_family,document_json").eq("id", job.song_document_id).single(),
        db.from("users").select("*").eq("id", job.user_id).single(),
      ]);
      if (docErr || !docRow) throw new Error(`song_document lookup failed: ${docErr?.message ?? "missing"}`);
      const plan = planForTier((userRow?.tier as UserTier | undefined) ?? "free", (userRow as { agent_plan?: string | null } | null)?.agent_plan);
      const doc = docRow as { language: string; style_family: string; document_json: { metadata?: { prompt?: string }; target_duration_seconds?: number } };
      const outcome = await advance(job.id, {
        sessions, store: runStore(db, plan.agent), environmentId,
        agentId: agentIdFor(plan.agent),
        log: (m) => trace.push(m.slice(0, 600)),
        maxLyriaCalls: plan.maxLyriaCalls, maxOutcomeIterations: plan.maxOutcomeIterations,
        brief: {
          language: doc.language, styleFamily: doc.style_family,
          targetSeconds: doc.document_json.target_duration_seconds ?? 30,
          prompt: doc.document_json.metadata?.prompt ?? "",
          engine: process.env.EMBED_URL && process.env.EMBED_TOKEN ? { url: process.env.EMBED_URL.trim(), token: mintEmbedToken(process.env.EMBED_TOKEN.trim()) } : undefined,
        },
        music: async (a) => {
          // Last gate before spend: the agent's own output is untrusted too.
          const v = await screenRequest(`${a.stylePrompt}\n${a.lyrics}`, "lyrics");
          if (!v.allowed) throw new SafetyRefusal(v.reason);
          return generateMusic({ ...a, stylePrompt: [a.stylePrompt, dictionHints(doc.language)].filter(Boolean).join(" ") }, { guard: spendGuard(db, { userId: job.user_id, userCapGbp: plan.userLyriaCapGbp }), apiKey: geminiKey });
        },
        saveAudio: async (jobId, n, r) => {
          // The storage RLS policy keys on the FIRST folder being the job id (tracks_storage_select_via_job).
          const path = `${jobId}/${n}.mp3`;
          const { error } = await db.storage.from("tracks").upload(path, r.audio, { contentType: r.mimeType, upsert: true });
          if (error) throw new Error(error.message);
          return path;
        },
      });
      results[job.id] = outcome;
      if (outcome === "done") {
        await finalize(db, job.id);
        await qaDiction(db, job.id, doc.language, geminiKey);
      }
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 300);
      results[job.id] = `error: ${msg}`;
      // Infrastructure hiccups (our own DB) are retried on the next tick; everything else fails the job.
      // Transient provider/network errors (429, 5xx, overloaded, resets) are retried on the next advance for up to 30 minutes.
      const status = (e as { status?: number }).status;
      const transient = isTransient(status, msg);
      const ageMs = job.started_at ? Date.now() - new Date(job.started_at).getTime() : 0;
      if (transient && ageMs < 30 * 60_000) {
        results[job.id] = `retry: ${msg}`;
      } else if (!/^agent_runs |song_document lookup/.test(msg)) {
        await db.from("jobs").update({ status: "failed", error: msg, finished_at: new Date().toISOString() }).eq("id", job.id);
      }
    } finally {
      await releaseLease(db, job.id);
    }
  };
  for (let i = 0; i < work.length; i += CONCURRENCY) {
    await Promise.all(work.slice(i, i + CONCURRENCY).map(runJob));
  }
  return { results, trace };
}

/** Best-effort: copy the agent's lyrics + song document out of the session sandbox into our database. */
async function persistOutputs(db: ReturnType<typeof serviceClient>, jobId: string, sessionId: string) {
  try {
    const client = anthropicClient();
    const files: { id: string; filename: string }[] = [];
    for await (const f of client.beta.files.list({ scope_id: sessionId, betas: ["managed-agents-2026-04-01"] })) {
      files.push({ id: f.id, filename: f.filename });
    }
    const read = async (name: string) => {
      const f = files.find((x) => x.filename.endsWith(name));
      return f ? await (await client.beta.files.download(f.id)).text() : null;
    };
    const lyrics = await read("lyrics.md");
    const docText = await read("song_document.json");
    let agentDoc: unknown = null;
    try { agentDoc = docText ? JSON.parse(docText) : null; } catch { agentDoc = null; }
    await db.from("agent_runs").update({ lyrics, agent_song_document: agentDoc }).eq("job_id", jobId);
    const title = (agentDoc as { title?: unknown } | null)?.title;
    const { data: job } = await db.from("jobs").select("song_document_id").eq("id", jobId).limit(1);
    const docId = ((job ?? [])[0] as { song_document_id: string } | undefined)?.song_document_id;
    if (docId) {
      const { data: sdRows } = await db.from("song_documents").select("document_json").eq("id", docId).limit(1);
      const sd = (sdRows ?? [])[0] as { document_json: { sections?: unknown[] } } | undefined;
      const patch: Record<string, unknown> = {};
      if (typeof title === "string" && title.trim()) patch.title = title.trim().slice(0, 120);
      if (sd && lyrics) patch.document_json = mergeLyrics(sd.document_json as { sections?: never[] }, lyrics);
      if (Object.keys(patch).length) await db.from("song_documents").update(patch).eq("id", docId);
    }
  } catch {
    /* outputs are a nicety; the audio and job state are already safe */
  }
}

async function finalize(db: ReturnType<typeof serviceClient>, jobId: string) {
  const { data: runRows } = await db.from("agent_runs").select("audio_path,status,session_id").eq("job_id", jobId).limit(1);
  const run = (runRows ?? [])[0] as { audio_path: string | null; status: string; session_id: string | null } | undefined;
  if (run?.session_id) await persistOutputs(db, jobId, run.session_id);
  const now = new Date().toISOString();
  if (!run?.audio_path || run.status === "failed") {
    await db.from("jobs").update({ status: "failed", error: "agent finished without audio", finished_at: now }).eq("id", jobId);
    return;
  }
  // One attempt per job: reuse the stored attempt_id so a repeated finalize can never insert a second track.
  const { data: jobRow } = await db.from("jobs").select("attempt_id").eq("id", jobId).limit(1);
  let attemptId = ((jobRow ?? [])[0] as { attempt_id: string | null } | undefined)?.attempt_id ?? null;
  if (!attemptId) {
    attemptId = crypto.randomUUID();
    await db.from("jobs").update({ attempt_id: attemptId }).eq("id", jobId);
  }
  await db.from("tracks").upsert({ job_id: jobId, attempt_id: attemptId, url: `tracks/${run.audio_path}`, format: "mp3" }, { onConflict: "job_id,attempt_id" });
  await db.from("jobs").update({ status: "completed", progress: 1, finished_at: now }).eq("id", jobId);
}

/** Best-effort post-render audit: Gemini hears the song, we score it against the intended lyrics. Never fails the job. */
async function qaDiction(db: ReturnType<typeof serviceClient>, jobId: string, language: string, geminiKey: string) {
  try {
    const { data: rows } = await db.from("agent_runs").select("audio_path,lyrics,diction_qa").eq("job_id", jobId).limit(1);
    const r = (rows ?? [])[0] as { audio_path: string | null; lyrics: string | null; diction_qa: unknown } | undefined;
    if (!r?.audio_path || !r.lyrics || r.diction_qa) return;
    const { data: blob } = await db.storage.from("tracks").download(r.audio_path);
    if (!blob) return;
    const audio = new Uint8Array(await blob.arrayBuffer());
    const qa = await auditDiction(r.lyrics, audio, blob.type || "audio/mpeg", language, geminiKey);
    await db.from("agent_runs").update({ diction_qa: { matchPct: qa.matchPct, flagged: qa.lines.filter((l) => l.flagged).map((l) => ({ line: l.intended, heard: l.heard, cer: Number(l.cer.toFixed(2)) })), model: process.env.GEMINI_QA_MODEL ?? "gemini-flash-latest" } }).eq("job_id", jobId);
  } catch {
    /* QA is advisory */
  }
}
