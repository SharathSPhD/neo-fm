/**
 * GET /api/admin/first-week[?days=7] -- launch measurement: signals by day (listeners, skip and finish rate, listened
 * minutes), the signup funnel by day, and cost per listener-hour. Aggregates only; no user ids leave the server.
 * Read-only, Bearer CRON_SECRET / AGENT_TICK_SECRET like the other admin endpoints.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { estimatedCostGbp } from "../../../../lib/agent/lyria";
import { costPerListenerHour, summarizeFirstWeek, type SignalRow } from "../../../../lib/ops/first-week";
import { loadFunnel, OpsQueryError } from "../../../../lib/ops/load";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const ROW_CAP = 50_000;

export async function GET(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const days = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 7) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = serviceClient();
  try {
    const [signals, ledger, pool, funnel] = await Promise.all([
      db.from("station_signals").select("user_id,kind,position_ms,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(ROW_CAP),
      db.from("user_spend").select("reserved_gbp"),
      db.from("pool_tracks").select("id", { count: "exact", head: true }).eq("status", "admitted"),
      loadFunnel(db, days),
    ]);
    const err = [signals, ledger, pool].find((r) => r.error)?.error;
    if (err) throw new OpsQueryError(err.message);
    const week = summarizeFirstWeek((signals.data ?? []) as SignalRow[], days);
    const ledgerGbp = (ledger.data ?? []).reduce((a, r) => a + Number(r.reserved_gbp), 0);
    return NextResponse.json({
      ...week,
      truncated: (signals.data?.length ?? 0) >= ROW_CAP,
      funnel,
      // Spend is all-time while listener-hours cover only the window, so this is the cost to date over recent listening.
      cost: costPerListenerHour(week.totals.listened_minutes, ledgerGbp, pool.count ?? 0, estimatedCostGbp("full")),
    });
  } catch (e) {
    if (e instanceof OpsQueryError) return NextResponse.json({ error: "query_failed", detail: e.message }, { status: 502 });
    throw e;
  }
}
