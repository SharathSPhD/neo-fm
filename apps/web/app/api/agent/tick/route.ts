/**
 * /api/agent/tick -- cron-driven worker for the Managed Agents pipeline.
 * Claims a few queued jobs, advances every running agent run, and finalizes
 * finished ones (track row + job completed). Idempotent; safe to call often.
 * Auth: `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this).
 */
import { NextResponse, type NextRequest } from "next/server";

import { checkBearer } from "../../../../lib/agent/auth";
import { runStore, serviceClient, sessionApi, spendGuard } from "../../../../lib/agent/adapters";
import { generateMusic } from "../../../../lib/agent/lyria";
import { advance } from "../../../../lib/agent/runner";
import { screenRequest } from "../../../../lib/safety";
import { agentIdFor, planForTier, requireId, type UserTier } from "../../../../lib/agent/tiers";

class SafetyRefusal extends Error {}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_CLAIM = 3;

export async function GET(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized", ...auth.diag }, { status: 401 });
  }
  const geminiKey = process.env.GEMINI_API_KEY;
  let environmentId: string;
  try {
    environmentId = requireId("MA_ENVIRONMENT_ID", process.env.MA_ENVIRONMENT_ID, "env_");
  } catch (e) {
    return NextResponse.json({ error: "not_configured", message: (e as Error).message }, { status: 503 });
  }
  if (!geminiKey) return NextResponse.json({ error: "not_configured", message: "Missing GEMINI_API_KEY" }, { status: 503 });

  const db = serviceClient();
  const sessions = sessionApi();
  const guard = spendGuard(db);

  // Claim: queued -> processing is a conditional update, so two ticks never take the same job.
  const { data: queued } = await db.from("jobs").select("id").eq("status", "queued").order("created_at").limit(MAX_CLAIM);
  for (const j of queued ?? []) {
    await db.from("jobs").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", j.id).eq("status", "queued");
  }

  // Plain queries (no PostgREST embeds): embed resolution depends on the schema cache
  // and failed silently once; errors are surfaced instead of swallowed.
  const { data: active, error: activeErr } = await db
    .from("jobs")
    .select("id,user_id,song_document_id")
    .eq("status", "processing");
  if (activeErr) return NextResponse.json({ error: "jobs_query_failed", message: activeErr.message }, { status: 500 });

  const results: Record<string, string> = {};
  const trace: string[] = [];
  for (const job of (active ?? []) as { id: string; user_id: string; song_document_id: string }[]) {
    try {
      const [{ data: docRow, error: docErr }, { data: userRow }] = await Promise.all([
        db.from("song_documents").select("language,style_family,document_json").eq("id", job.song_document_id).single(),
        db.from("users").select("tier").eq("id", job.user_id).single(),
      ]);
      if (docErr || !docRow) throw new Error(`song_document lookup failed: ${docErr?.message ?? "missing"}`);
      const plan = planForTier((userRow?.tier as UserTier | undefined) ?? "free");
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
        },
        music: async (a) => {
          // Last gate before spend: the agent's own output is untrusted too.
          const v = await screenRequest(`${a.stylePrompt}\n${a.lyrics}`, "lyrics");
          if (!v.allowed) throw new SafetyRefusal(v.reason);
          return generateMusic(a, { guard, apiKey: geminiKey });
        },
        saveAudio: async (jobId, n, r) => {
          const path = `${job.user_id}/${jobId}/${n}.mp3`;
          const { error } = await db.storage.from("tracks").upload(path, r.audio, { contentType: r.mimeType, upsert: true });
          if (error) throw new Error(error.message);
          return path;
        },
      });
      results[job.id] = outcome;
      if (outcome === "done") await finalize(db, job.id);
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 300);
      results[job.id] = `error: ${msg}`;
      // Infrastructure hiccups (our own DB) are retried on the next tick; everything else fails the job.
      if (!/^agent_runs |song_document lookup/.test(msg)) {
        await db.from("jobs").update({ status: "failed", error: msg, finished_at: new Date().toISOString() }).eq("id", job.id);
      }
    }
  }
  return NextResponse.json({ results, trace });
}

async function finalize(db: ReturnType<typeof serviceClient>, jobId: string) {
  const { data: run } = await db.from("agent_runs").select("audio_path,status").eq("job_id", jobId).maybeSingle();
  const now = new Date().toISOString();
  if (!run?.audio_path || run.status === "failed") {
    await db.from("jobs").update({ status: "failed", error: "agent finished without audio", finished_at: now }).eq("id", jobId);
    return;
  }
  const attemptId = crypto.randomUUID();
  await db.from("jobs").update({ attempt_id: attemptId }).eq("id", jobId);
  await db.from("tracks").upsert({ job_id: jobId, attempt_id: attemptId, url: `tracks/${run.audio_path}`, format: "mp3" }, { onConflict: "job_id,attempt_id" });
  await db.from("jobs").update({ status: "completed", progress: 1, finished_at: now }).eq("id", jobId);
}
