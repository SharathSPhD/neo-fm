/**
 * Shared worker: advances Managed Agents runs. Called by the cron tick and, pull-style,
 * by the song poll route so a job moves as soon as its owner is watching it.
 */
import { anthropicClient, runStore, serviceClient, sessionApi, spendGuard } from "./adapters";
import { lyriaBreaker } from "./circuit-breaker";
import { generateMusic } from "./lyria";
import { advance, type AdvanceDeps } from "./runner";
import { hostAdvance } from "../cascade/host-run";
import { adoptPolishedLyrics, hostCascadeDeps, loadHostSong, saveHostSong } from "../cascade/host-io";
import { screenRequest } from "../safety";
import { mergeLyrics } from "./lyrics-merge";
import { livePolishTemplate, polishLyrics } from "../lyrics/polish";
import { auditDiction } from "../diction/gemini";
import { CostCollector, type TokenUsage } from "../cost/usage";
import { dictionHintsFor, scoreTranscriptUnordered } from "../diction";
import { intentBlock } from "../engine/intent";
import { judgeAndRetry } from "../engine/judge";
import { voiceChoiceFor, voiceHint } from "../voice";
import { judgeLeadGender, renderWithVoiceCheck } from "../voice/check";
import { dictionVerdict, gateMode } from "../diction/gate";
import { alignLines, toPayload, transcribeTimed } from "../diction/timestamps";
import { singableLines } from "../lyrics/singable";
import { ROMAN_HINT, singingScript } from "../diction/romanize";
import { hasPersonalizationConsent, loadTaste } from "../personalization/load";
import { embedEngine, embedderUsed, safeEmbedUrl } from "./embed-url";
import { hasStationPass, withPassCap } from "../billing/pass";
import { agentIdFor, planForTier, type UserTier } from "./tiers";

class SafetyRefusal extends Error {}

export function isTransient(status: number | undefined, msg: string): boolean {
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  return /overloaded|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|network/i.test(msg);
}

const MAX_CLAIM = 12;
/** Sliding pool: a slow render no longer holds back jobs queued behind it (was fixed batches of 4). */
export const POOL_SIZE = 8;
/** Fleet-wide ceiling on jobs being worked at once (ticks overlap, so POOL_SIZE alone is per tick). */
export const GLOBAL_MAX = 10;
/** A job is not started this late in a tick: the function is killed at ~300 s and the lease would be held for nothing. */
export const START_DEADLINE_MS = 200_000;
export const TIER_WEIGHT: Record<string, number> = { pro: 3, developer: 3, creator: 2, free: 1 };

/** Weighted aging: score = minutes waited x tier weight, highest first, so paying tiers go first but nobody starves. */
export function prioritise<T extends { started_at?: string | null }>(jobs: T[], weightOf: (j: T) => number, now = Date.now()): T[] {
  const score = (j: T) => Math.max(1, (now - (j.started_at ? new Date(j.started_at).getTime() : now)) / 60_000 + 1) * weightOf(j);
  return [...jobs].sort((a, b) => score(b) - score(a));
}

/** Run `fn` over `items` with at most `size` in flight, starting the next as soon as any finishes. */
export async function runPool<T>(items: T[], size: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i] as T); } };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}
/** How often a held job re-checks its agent session inside one tick (was: once per cron minute). */
export const POLL_INTERVAL_MS = 5_000;
/** Stop polling this far into a tick: leaves room for an in-flight render, finalize and QA before the ~300 s kill. */
export const POLL_DEADLINE_MS = 210_000;
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
  const activeQuery = db.from("jobs").select("id,user_id,song_document_id,started_at,agent_lease_until").eq("status", "processing");
  const { data: active, error: activeErr } = await (onlyJobId ? activeQuery.eq("id", onlyJobId) : activeQuery);
  if (activeErr) throw new Error(`jobs_query_failed: ${activeErr.message}`);

  const results: Record<string, string> = {};
  const trace: string[] = [];
  // Renders take ~30s+ each, so jobs run in a sliding parallel pool, highest weighted-age first.
  const tickStart = Date.now();
  const allActive = (active ?? []) as { id: string; user_id: string; song_document_id: string; started_at?: string | null; agent_lease_until?: string | null }[];
  const nowMs = Date.now();
  const live = allActive.filter((j) => j.agent_lease_until && new Date(j.agent_lease_until).getTime() > nowMs).length;
  // Jobs another tick holds are skipped, and new work is capped so overlapping ticks cannot exceed GLOBAL_MAX renders.
  const free = allActive.filter((j) => !(j.agent_lease_until && new Date(j.agent_lease_until).getTime() > nowMs));
  const room = onlyJobId ? free.length : Math.max(0, GLOBAL_MAX - live);
  const runJob = async (job: { id: string; user_id: string; song_document_id: string; started_at?: string | null }) => {
    if (Date.now() - tickStart > START_DEADLINE_MS) { results[job.id] = "deferred"; return; }
    if (!(await takeLease(db, job.id))) { results[job.id] = "busy"; return; }
    try {
      const [{ data: docRow, error: docErr }, { data: userRow }] = await Promise.all([
        db.from("song_documents").select("language,style_family,document_json").eq("id", job.song_document_id).single(),
        db.from("users").select("*").eq("id", job.user_id).single(),
      ]);
      if (docErr || !docRow) throw new Error(`song_document lookup failed: ${docErr?.message ?? "missing"}`);
      // A Station pass raises the monthly personal-track envelope; without migration 0098 this is just the tier plan.
      const hasPass = await hasStationPass(db, job.user_id);
      const plan = withPassCap(
        planForTier((userRow?.tier as UserTier | undefined) ?? "free", (userRow as { agent_plan?: string | null } | null)?.agent_plan),
        hasPass,
      );
      const doc = docRow as { language: string; style_family: string; document_json: { metadata?: { prompt?: string; voice?: unknown }; target_duration_seconds?: number } };
      let tasteCard = "";
      try { if (await hasPersonalizationConsent(db, job.user_id)) tasteCard = (await loadTaste(db, job.user_id)).card; } catch { /* personalization is optional */ }
      // Per-stage wall-clock (ms) for job_telemetry.metrics.stages_ms. Only stages observed in this tick are recorded.
      const stages: Record<string, number> = {};
      const cost = new CostCollector();
      const timed = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
        const t0 = Date.now();
        try { return await fn(); } finally { stages[name] = (stages[name] ?? 0) + (Date.now() - t0); }
      };
      let postRenderFrom = 0;
      const brief = {
        language: doc.language, styleFamily: doc.style_family,
        targetSeconds: doc.document_json.target_duration_seconds ?? 30,
        prompt: doc.document_json.metadata?.prompt ?? "",
        tasteCard: tasteCard || undefined,
        engine: embedEngine(job.id),
      };
      // agent_runs.agent_key is constrained to free|pro; the variant is recorded in job_telemetry.metrics.plan instead.
      const store = runStore(db, plan.agent === "free" ? "free" : "pro");
      const gate = () => { const g = lyriaBreaker.acquire(); return g.ok ? null : `lyria circuit open, retry in ${Math.ceil(g.retryInMs / 1000)}s`; };
      const log = (m: string) => trace.push(m.slice(0, 600));
      const music: AdvanceDeps["music"] = async (a0) => {
        let a = a0;
        // Time from the job starting to the agent asking for a render (tick granularity: +-1 cron minute).
        if (job.started_at && stages.agent_draft === undefined) stages.agent_draft = Math.max(0, Date.now() - new Date(job.started_at).getTime());
        // Last gate before spend: the agent's own output is untrusted too.
        const v = await screenRequest(`${a.stylePrompt}\n${a.lyrics}`, "lyrics");
        if (!v.allowed) throw new SafetyRefusal(v.reason);
        // The structured intent (PCE_INTENT) rides along from the cascade; polish sees it as part of the brief and the judge reads against it.
        const savedIntent = plan.agent === "host" && (process.env.PCE_INTENT === "1" || process.env.PCE_JUDGE_RETRY === "1") ? (await loadHostSong(db, job.id).catch(() => null))?.intent : undefined;
        const polishBrief = savedIntent ? `${doc.document_json.metadata?.prompt ?? ""}\n${intentBlock(savedIntent)}` : doc.document_json.metadata?.prompt ?? "";
        // Engine-mode songs get a Sonnet prosody/diction polish (eval: PCE+polish beat best-of-6+polish 7-3); sung text = stored text.
        if (embedEngine(job.id) && process.env.PCE_POLISH !== "0") {
          try {
            a = { ...a, lyrics: await timed("polish", async () => polishLyrics(anthropicClient(), { language: doc.language, style: doc.style_family, brief: polishBrief, lyrics: a.lyrics }, await livePolishTemplate(db), cost.polish)) };
            const v2 = await screenRequest(a.lyrics, "lyrics");
            if (!v2.allowed) throw new SafetyRefusal(v2.reason);
            await db.from("agent_runs").update({ polished_lyrics: a.lyrics }).eq("job_id", job.id);
          } catch (e) { if (e instanceof SafetyRefusal) throw e; /* polish is best-effort; sing the engine's own lyrics */ }
        }
        // Judge-and-retry (PCE_JUDGE_RETRY): one cheap read of the final text against the intent, at most one targeted revision, kept only if not judged worse.
        if (savedIntent && process.env.PCE_JUDGE_RETRY === "1") {
          try {
            const client = anthropicClient();
            const ask = async (x: { model: string; prompt: string; maxTokens: number }) => {
              const res = await client.messages.create({ model: x.model, max_tokens: x.maxTokens, messages: [{ role: "user", content: x.prompt }] });
              return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
            };
            const jr = await timed("judge_retry", () => judgeAndRetry(
              { intent: savedIntent, lyrics: a.lyrics, language: doc.language, targetSeconds: doc.document_json.target_duration_seconds ?? 30 },
              { complete: ask, revise: ask, check: async (t) => (await screenRequest(t, "lyrics")).allowed, log },
            ));
            if (jr.kept === "revision") {
              a = { ...a, lyrics: jr.lyrics };
              await db.from("agent_runs").update({ polished_lyrics: a.lyrics }).eq("job_id", job.id);
            }
            log(`judge-retry retried=${jr.retried} kept=${jr.kept} intent=${jr.before?.intent ?? "?"}->${jr.after?.intent ?? "?"} script=${jr.deterministic.scriptOk}`);
          } catch (e) { if (e instanceof SafetyRefusal) throw e; /* judging is advisory; sing the polished lyrics */ }
        }
        // Pronunciation guide: romanization beside each native line cut Gemini-measured CER ~4x in the diction lab.
        const ss = process.env.DICTION_ROMAN === "0" ? null : singingScript(a.lyrics);
        const sung = ss?.romanized ? ss.text : a.lyrics;
        const voice = voiceChoiceFor(doc.document_json.metadata?.voice, userRow?.tier as UserTier | undefined, hasPass, process.env, doc.language);
        const render = () => generateMusic({ ...a, lyrics: sung, stylePrompt: [a.stylePrompt, voiceHint(voice), dictionHintsFor(doc.language), ss?.romanized ? ROMAN_HINT : ""].filter(Boolean).join(" ") }, { guard: spendGuard(db, { userId: job.user_id, userCapGbp: plan.userLyriaCapGbp }), breaker: lyriaBreaker, apiKey: geminiKey });
        // The gender cue is followed about 5 times in 6 (docs/voice-diversity.md), so a paid choice is checked and re-rendered once on a miss.
        return timed("lyria", async () => (await renderWithVoiceCheck(voice.choice, render, (r) => judgeLeadGender(r.audio, r.mimeType, geminiKey))).result);
      };
      const saveAudio: AdvanceDeps["saveAudio"] = async (jobId, n, r) => {
        // The storage RLS policy keys on the FIRST folder being the job id (tracks_storage_select_via_job).
        const path = `${jobId}/${n}.mp3`;
        const { error } = await timed("upload", async () => db.storage.from("tracks").upload(path, r.audio, { contentType: r.mimeType, upsert: true }));
        if (error) throw new Error(error.message);
        postRenderFrom = Date.now();
        return path;
      };
      const runAdvance = plan.agent === "host"
        ? () => hostAdvance(job.id, {
          store, maxLyriaCalls: plan.maxLyriaCalls, brief, music, saveAudio, gate, gateRelease: () => lyriaBreaker.release(), timed, log,
          cascade: hostCascadeDeps(anthropicClient(), log),
          loadSong: () => loadHostSong(db, job.id),
          saveSong: (song) => saveHostSong(db, job.id, job.song_document_id, song),
        })
        : () => advance(job.id, {
          sessions, store, environmentId, agentId: agentIdFor(plan.agent), log,
          maxLyriaCalls: plan.maxLyriaCalls, maxOutcomeIterations: plan.maxOutcomeIterations,
          brief, music, gate, gateRelease: () => lyriaBreaker.release(), finishOnRender: true, saveAudio,
        });
      let outcome = await runAdvance();
      let configAssigned = false;
      // The agent drafts for minutes and the render request only reaches us when we look, so keep looking while we hold the
      // lease instead of waiting for the next cron minute (adds up to 60 s per poll boundary: session start, render request).
      for (;;) {
        if (outcome === "started" && !configAssigned) { configAssigned = true; await assignConfig(db, job.id); }
        if ((outcome !== "waiting" && outcome !== "started") || Date.now() - tickStart >= POLL_DEADLINE_MS) break;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        outcome = await runAdvance();
      }
      if (outcome === "done" && postRenderFrom) stages.post_render = Date.now() - postRenderFrom;
      results[job.id] = outcome;
      if (outcome === "done") {
        // The song is playable once finalize marks it completed; the Gemini audits are advisory, so they run after that
        // (in parallel) instead of adding ~25 s before the listener sees the track.
        if (plan.agent === "host") await adoptPolishedLyrics(db, job.id, job.song_document_id);
        const finalized = await timed("finalize", () => finalize(db, job.id));
        const cascade = finalized ?? (plan.agent === "host" ? (await loadHostSong(db, job.id))?.cascade ?? null : null);
        const targetS = doc.document_json.target_duration_seconds ?? 30;
        const [qa] = await Promise.all([
          timed("qa", () => qaDiction(db, job.id, doc.language, geminiKey, cost.qa)),
          timed("line_timings", () => qaLineTimings(db, job.id, doc.language, geminiKey, targetS)),
        ]);
        await recordTelemetry(db, job.id, { plan: plan.agent, language: doc.language, style: doc.style_family, target_s: doc.document_json.target_duration_seconds ?? null, started_at: job.started_at ?? null, cascade, diction_match_pct: qa?.matchPct ?? null, qa_model: process.env.GEMINI_QA_MODEL ?? "gemini-3.8-flash", embedder: embedderUsed(!!safeEmbedUrl(process.env.EMBED_URL), cascade), stages_ms: stages }, cost);
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
  const tiers = new Map<string, string>();
  if (free.length > 1) {
    const { data: us } = await db.from("users").select("id,tier").in("id", [...new Set(free.map((w) => w.user_id))]);
    for (const u of (us ?? []) as { id: string; tier: string | null }[]) tiers.set(u.id, u.tier ?? "free");
  }
  await runPool(prioritise(free, (j) => TIER_WEIGHT[tiers.get(j.user_id) ?? "free"] ?? 1).slice(0, room), POOL_SIZE, runJob);
  return { results, trace };
}

/** Best-effort: copy the agent's lyrics + song document out of the session sandbox into our database. */
async function persistOutputs(db: ReturnType<typeof serviceClient>, jobId: string, sessionId: string): Promise<Record<string, unknown> | null> {
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
    const { data: pl } = await db.from("agent_runs").select("polished_lyrics").eq("job_id", jobId).limit(1);
    const lyrics = ((pl ?? [])[0] as { polished_lyrics: string | null } | undefined)?.polished_lyrics || (await read("lyrics.md"));
    const docText = await read("song_document.json");
    const auditText = await read("cascade_audit.json");
    let cascade: Record<string, unknown> | null = null;
    try {
      const a = auditText ? (JSON.parse(auditText) as { committed?: string; vimarsa_event?: boolean; vimarsa_novelty?: number; embedder?: string; embedder_fallback?: string | null; posterior?: number[]; audit?: { audit?: Record<string, unknown> } }) : null;
      if (a) cascade = { committed: a.committed, vimarsa_event: a.vimarsa_event, novelty: a.vimarsa_novelty, embedder: a.embedder, embedder_fallback: a.embedder_fallback ?? undefined, k: a.posterior?.length, delta_F: a.audit?.audit?.delta_F, two_pass: a.audit?.audit?.two_pass };
    } catch { cascade = null; }
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
    return cascade;
  } catch {
    /* outputs are a nicety; the audio and job state are already safe */
    return null;
  }
}

/** Machine-readable failure code shown to users as friendly copy (components/job-progress.tsx); the raw reason stays in agent_runs.render_error. */
export function failureCode(renderError?: string | null): string {
  if (renderError && /spend cap/i.test(renderError)) return "allowance_reached";
  if (renderError && /content policy|safety/i.test(renderError)) return "content_policy";
  return renderError ? "render_failed" : "agent finished without audio";
}

async function finalize(db: ReturnType<typeof serviceClient>, jobId: string): Promise<Record<string, unknown> | null> {
  const { data: runRows } = await db.from("agent_runs").select("audio_path,status,session_id,render_error").eq("job_id", jobId).limit(1);
  const run = (runRows ?? [])[0] as { audio_path: string | null; status: string; session_id: string | null; render_error?: string | null } | undefined;
  const cascade = run?.session_id ? await persistOutputs(db, jobId, run.session_id) : null;
  const now = new Date().toISOString();
  if (!run?.audio_path || run.status === "failed") {
    await db.from("jobs").update({ status: "failed", error: failureCode(run?.render_error), finished_at: now }).eq("id", jobId);
    return cascade;
  }
  // One attempt per job: reuse the stored attempt_id so a repeated finalize can never insert a second track.
  const { data: jobRow } = await db.from("jobs").select("attempt_id").eq("id", jobId).limit(1);
  let attemptId = ((jobRow ?? [])[0] as { attempt_id: string | null } | undefined)?.attempt_id ?? null;
  if (!attemptId) {
    attemptId = crypto.randomUUID();
    await db.from("jobs").update({ attempt_id: attemptId }).eq("id", jobId);
  }
  // Insert-if-absent keyed on the job (the production schema's unique indexes are (job_id, attempt_id, candidate_index) and one
  // is_current row per job, which an upsert on (job_id, attempt_id) cannot target). An insert error must NOT be swallowed:
  // a job without its track row looks completed but plays nothing.
  const { data: existing } = await db.from("tracks").select("id").eq("job_id", jobId).limit(1);
  if (!(existing ?? []).length) {
    const { error: trackErr } = await db.from("tracks").insert({ job_id: jobId, attempt_id: attemptId, url: `tracks/${run.audio_path}`, format: "mp3" });
    if (trackErr) throw new Error(`tracks insert failed: ${trackErr.message}`);
  }
  await db.from("jobs").update({ status: "completed", progress: 1, finished_at: now }).eq("id", jobId);
  return cascade;
}

/** Best-effort post-render audit: Gemini hears the song, we score it against the intended lyrics. Never fails the job. */
export async function qaDiction(db: ReturnType<typeof serviceClient>, jobId: string, language: string, geminiKey: string, onUsage?: (u: TokenUsage) => void): Promise<{ matchPct: number } | null> {
  try {
    const { data: rows } = await db.from("agent_runs").select("audio_path,lyrics,diction_qa").eq("job_id", jobId).limit(1);
    const r = (rows ?? [])[0] as { audio_path: string | null; lyrics: string | null; diction_qa: unknown } | undefined;
    if (!r?.audio_path || !r.lyrics) { await db.from("agent_runs").update({ diction_qa: { error: !r?.audio_path ? "no audio" : "no lyrics captured" } }).eq("job_id", jobId); return null; }
    if ((r.diction_qa as { matchPct?: number } | null)?.matchPct !== undefined) return null;
    const { data: blob } = await db.storage.from("tracks").download(r.audio_path);
    if (!blob) return null;
    const audio = new Uint8Array(await blob.arrayBuffer());
    // Score against the sung lines only: a "Pallavi:" header counted as a line scored as a miss (te-16: 66 -> 97).
    const sung = singableLines(r.lyrics).join("\n") || r.lyrics;
    const qa = await auditDiction(sung, audio, blob.type || "audio/mpeg", language, geminiKey, undefined, onUsage);
    // Shadow gate (DICTION_GATE=off disables): record the verdict and the order-free score; nothing the user sees changes.
    const gate = gateMode() === "off" ? null : dictionVerdict(qa, scoreTranscriptUnordered(sung, qa.transcript));
    await db.from("agent_runs").update({ diction_qa: { matchPct: qa.matchPct, flagged: qa.lines.filter((l) => l.flagged).map((l) => ({ line: l.intended, heard: l.heard, cer: Number(l.cer.toFixed(2)) })), model: process.env.GEMINI_QA_MODEL ?? "gemini-3.8-flash", ...(gate ? { unorderedPct: gate.unorderedPct, verdict: gate.verdict, reasons: gate.reasons, reordered: gate.reordered, tailUnsung: gate.tailUnsung } : {}) } }).eq("job_id", jobId);
    return { matchPct: qa.matchPct };
  } catch (e) {
    /* QA is advisory, but leave the reason visible instead of failing silently */
    const msg = String((e as Error)?.message ?? e).slice(0, 240);
    console.error("diction qa failed", jobId, msg);
    try { await db.from("agent_runs").update({ diction_qa: { error: msg } }).eq("job_id", jobId); } catch { /* ignore */ }
    return null;
  }
}

/** Best-effort synced-lyrics timings (agent_runs.line_timings). One retry on an empty reply; never fails the job. */
export async function qaLineTimings(db: ReturnType<typeof serviceClient>, jobId: string, language: string, geminiKey: string, targetS: number): Promise<boolean> {
  try {
    const { data: rows } = await db.from("agent_runs").select("audio_path,lyrics,line_timings").eq("job_id", jobId).limit(1);
    const r = (rows ?? [])[0] as { audio_path: string | null; lyrics: string | null; line_timings: unknown } | undefined;
    if (!r?.audio_path || !r.lyrics || r.line_timings) return false;
    const lines = singableLines(r.lyrics);
    if (!lines.length) return false;
    const { data: blob } = await db.storage.from("tracks").download(r.audio_path);
    if (!blob) return false;
    const audio = new Uint8Array(await blob.arrayBuffer());
    let segs = await transcribeTimed(audio, blob.type || "audio/mpeg", language, geminiKey);
    if (!segs.length) segs = await transcribeTimed(audio, blob.type || "audio/mpeg", language, geminiKey);
    if (!segs.length) return false;
    const durationS = Math.max(targetS, ...segs.map((s) => s.startS));
    await db.from("agent_runs").update({ line_timings: toPayload(alignLines(lines, segs, durationS), durationS) }).eq("job_id", jobId);
    return true;
  } catch (e) {
    console.error("line timings failed", jobId, String((e as Error)?.message ?? e).slice(0, 240));
    return false;
  }
}

let liveConfig: { id: string; at: number } | null = null;
/** The pipeline config version in force (cached 60 s); every job is attributed to one so experiments are measurable. */
async function liveConfigId(db: ReturnType<typeof serviceClient>): Promise<string | null> {
  if (liveConfig && Date.now() - liveConfig.at < 60_000) return liveConfig.id;
  const { data } = await db.from("config_versions").select("id").eq("kind", "pipeline").eq("status", "live").limit(1);
  const id = ((data ?? [])[0] as { id: string } | undefined)?.id ?? null;
  if (id) liveConfig = { id, at: Date.now() };
  return id;
}

async function assignConfig(db: ReturnType<typeof serviceClient>, jobId: string) {
  try {
    const id = await liveConfigId(db);
    if (id) await db.from("job_assignments").upsert({ job_id: jobId, config_version_id: id, arm: "control" }, { onConflict: "job_id", ignoreDuplicates: true });
  } catch { /* telemetry never blocks a job */ }
}

async function recordTelemetry(db: ReturnType<typeof serviceClient>, jobId: string, extra: Record<string, unknown>, cost?: CostCollector) {
  try {
    const { data: runs } = await db.from("agent_runs").select("lyria_calls").eq("job_id", jobId).limit(1);
    const { data: jobs } = await db.from("jobs").select("created_at,started_at,finished_at").eq("id", jobId).limit(1);
    const j = ((jobs ?? [])[0] ?? {}) as { created_at?: string; started_at?: string; finished_at?: string };
    if (j.created_at && j.started_at && extra.stages_ms && typeof extra.stages_ms === "object") (extra.stages_ms as Record<string, number>).queue_wait = Math.max(0, new Date(j.started_at).getTime() - new Date(j.created_at).getTime());
    const latency_ms = j.started_at && j.finished_at ? new Date(j.finished_at).getTime() - new Date(j.started_at).getTime() : null;
    const lyria_calls = Number(((runs ?? [])[0] as { lyria_calls?: number } | undefined)?.lyria_calls ?? 0);
    if (cost) {
      cost.lyria(lyria_calls);
      try { // Managed Agents session usage; best effort so a billing read can never fail telemetry. Host-cascade jobs have no session.
        const { data: sr } = await db.from("agent_runs").select("session_id").eq("job_id", jobId).limit(1);
        const sid = ((sr ?? [])[0] as { session_id?: string | null } | undefined)?.session_id;
        if (sid) cost.session((await anthropicClient().beta.sessions.retrieve(sid) as unknown as { usage?: unknown }).usage);
      } catch { /* cost is optional */ }
    }
    await db.from("job_telemetry").upsert({ job_id: jobId, config_version_id: await liveConfigId(db), metrics: { ...extra, latency_ms, lyria_calls, ...(cost ? { cost: cost.toJSON() } : {}) } }, { onConflict: "job_id" });
  } catch { /* telemetry never blocks a job */ }
}
