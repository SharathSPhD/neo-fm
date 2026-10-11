/**
 * /api/agent/tick -- cron-driven worker for the Managed Agents pipeline.
 * Claims a few queued jobs, advances every running agent run, and finalizes
 * finished ones (track row + job completed). Idempotent; safe to call often.
 * Auth: `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this).
 */
import { NextResponse, type NextRequest } from "next/server";

import { runStore, serviceClient, sessionApi, spendGuard } from "../../../../lib/agent/adapters";
import { generateMusic } from "../../../../lib/agent/lyria";
import { advance } from "../../../../lib/agent/runner";
import { screenRequest } from "../../../../lib/safety";
import { agentIdFor, planForTier, type UserTier } from "../../../../lib/agent/tiers";

class SafetyRefusal extends Error {}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_CLAIM = 3;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const environmentId = process.env.MA_ENVIRONMENT_ID;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!environmentId || !geminiKey) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const db = serviceClient();
  const sessions = sessionApi();
  const guard = spendGuard(db);

  // Claim: queued -> processing is a conditional update, so two ticks never take the same job.
  const { data: queued } = await db.from("jobs").select("id").eq("status", "queued").order("created_at").limit(MAX_CLAIM);
  for (const j of queued ?? []) {
    await db.from("jobs").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", j.id).eq("status", "queued");
  }

  const { data: active } = await db
    .from("jobs")
    .select("id,user_id,song_document_id,song_documents(language,style_family,document_json),users(tier)")
    .eq("status", "processing");

  const results: Record<string, string> = {};
  for (const job of (active ?? []) as unknown as {
    id: string; user_id: string; song_document_id: string;
    song_documents: { language: string; style_family: string; document_json: { metadata?: { prompt?: string }; target_duration_seconds?: number } };
    users: { tier: UserTier } | null;
  }[]) {
    try {
      const plan = planForTier(job.users?.tier);
      const doc = job.song_documents;
      const outcome = await advance(job.id, {
        sessions, store: runStore(db, plan.agent), environmentId,
        agentId: agentIdFor(plan.agent),
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
      results[job.id] = "error";
      await db.from("jobs").update({ status: "failed", error: String((e as Error).message).slice(0, 500), finished_at: new Date().toISOString() }).eq("id", job.id);
    }
  }
  return NextResponse.json({ results });
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
