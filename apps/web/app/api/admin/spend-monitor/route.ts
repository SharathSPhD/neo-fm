/**
 * /api/admin/spend-monitor -- daily, read-only report of Lyria spend vs LYRIA_BUDGET_GBP plus leaked / stale reservations.
 * Auth: Bearer CRON_SECRET / AGENT_TICK_SECRET (Vercel Cron sends GET). Never writes; see lib/spend/monitor.ts for the method.
 * HTTP 200 means the check ran (`ok:false` = alerts present); 5xx means it could not run.
 */
import { NextRequest, NextResponse } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkBearer } from "../../../../lib/agent/auth";
import { estimatedCostGbp } from "../../../../lib/agent/lyria";
import { analyseSpend, type RunRow, type UserSpendRow } from "../../../../lib/spend/monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type JoinedRun = { job_id: string; status: string; lyria_calls: number; updated_at: string; jobs: { user_id: string; created_at: string } | { user_id: string; created_at: string }[] | null };

export async function GET(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const period = new Date().toISOString().slice(0, 7) + "-01";
  const db = serviceClient();

  const { data: spend, error: e1 } = await db.from("user_spend").select("user_id,reserved_gbp").eq("provider", "lyria").eq("period", period).limit(10_000);
  if (e1) return NextResponse.json({ error: `user_spend: ${e1.message}` }, { status: 500 });

  const { data: runs, error: e2 } = await db
    .from("agent_runs").select("job_id,status,lyria_calls,updated_at,jobs!inner(user_id,created_at)")
    .gte("jobs.created_at", period).limit(10_000);
  if (e2) return NextResponse.json({ error: `agent_runs: ${e2.message}` }, { status: 500 });

  const users: UserSpendRow[] = (spend ?? []).map((r) => ({ user_id: String(r.user_id), reserved_gbp: Number(r.reserved_gbp) }));
  const runRows: RunRow[] = ((runs ?? []) as unknown as JoinedRun[]).flatMap((r) => {
    const j = Array.isArray(r.jobs) ? r.jobs[0] : r.jobs;
    return j ? [{ job_id: r.job_id, user_id: j.user_id, status: r.status, lyria_calls: Number(r.lyria_calls ?? 0), updated_at: r.updated_at }] : [];
  });

  const report = analyseSpend(period, users, runRows, {
    clipCostGbp: estimatedCostGbp("clip"),
    fullCostGbp: estimatedCostGbp("full"),
    globalCapGbp: Number(process.env.LYRIA_BUDGET_GBP ?? "3"),
    staleRunMinutes: 30,
    warnFraction: 0.8,
  });
  if (report.alerts.length) console.warn("[spend-monitor]", JSON.stringify(report.alerts));
  return NextResponse.json({ ok: report.alerts.length === 0, ...report, truncated: users.length >= 10_000 || runRows.length >= 10_000 });
}
