/**
 * POST /api/admin/lyrics-teacher (Bearer ADMIN_SECRET)
 * Body: { model: "claude-sonnet-5-5" | "claude-haiku-5-5", system?, max_tokens?, max_usd?, jobs: [{ id, prompt, n? }] }
 * Generates n completions per job on prod's own Anthropic key (the same route CMA uses) for the lyrics lab's teacher data.
 * Bounded: <=60 jobs, <=160 generations, <=800 output tokens each, refuses when the list-price estimate exceeds max_usd
 * (default 1, hard cap 6) and stops early when metered spend reaches it. Nothing is stored; prompt text is not logged.
 * Returns { results: { [id]: string[] }, estimate_usd, spend } where spend is the metered token usage (see lib/eval/cost).
 */
import { NextResponse, type NextRequest } from "next/server";

import { anthropicClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { meter } from "../../../../lib/eval/cost";
import { planTeacher } from "../../../../lib/eval/teacher";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;

const CONCURRENCY = 4;

export async function POST(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const planned = planTeacher(await req.json().catch(() => null));
  if (!planned.ok) return NextResponse.json({ error: planned.error }, { status: 400 });
  const { plan } = planned;
  const client = anthropicClient();
  meter.reset();
  const queue = plan.jobs.flatMap((j) => Array.from({ length: j.n }, () => j));
  const results: Record<string, string[]> = Object.fromEntries(plan.jobs.map((j) => [j.id, []]));
  let next = 0, stopped = false, failed = 0;
  const worker = async () => {
    while (next < queue.length && !stopped) {
      const job = queue[next++]!;
      if (meter.usd() >= plan.maxUsd) { stopped = true; break; }
      try {
        const res = await client.messages.create({
          model: plan.model, max_tokens: plan.maxTokens, ...(plan.system ? { system: plan.system } : {}),
          messages: [{ role: "user", content: job.prompt }],
        });
        meter.record(plan.model, res.usage);
        const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
        if (text) results[job.id]!.push(text); else failed++;
      } catch { failed++; }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return NextResponse.json({ results, calls_planned: plan.calls, failed, stopped_at_cap: stopped, estimate_usd: plan.estimateUsd, spend: meter.snapshot() });
}
