/**
 * GET /api/admin/health-snapshot -- store today's (UTC) health summary + 1-day funnel for trend charts.
 * Bearer CRON_SECRET / AGENT_TICK_SECRET; Vercel Cron calls it with GET. Idempotent per day: a re-run overwrites
 * that day's row. Its only write is the health_snapshots table (migration 0075).
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkBearer } from "../../../../lib/agent/auth";
import { loadFunnel, loadHealthSummary, OpsQueryError } from "../../../../lib/ops/load";
import { stripForStorage } from "../../../../lib/ops/snapshot";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = serviceClient();
  try {
    const [summary, funnel] = await Promise.all([loadHealthSummary(db, 24), loadFunnel(db, 1).catch(() => null)]);
    const day = new Date().toISOString().slice(0, 10);
    const { error } = await db.from("health_snapshots").upsert({ day, summary: stripForStorage(summary), funnel }, { onConflict: "day" });
    if (error) return NextResponse.json({ error: "snapshot_failed", detail: error.message }, { status: 502 });
    return NextResponse.json({ ok: true, day, alerts: summary.alerts });
  } catch (e) {
    if (e instanceof OpsQueryError) return NextResponse.json({ error: "query_failed", detail: e.message }, { status: 502 });
    throw e;
  }
}
