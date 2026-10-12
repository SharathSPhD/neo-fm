/** GET /api/admin/funnel[?days=7] -- funnel counts (Bearer CRON_SECRET / AGENT_TICK_SECRET). Read-only. */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { buildFunnel, type FunnelRow } from "../../../../lib/ops/funnel";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const COHORT_CAP = 2000;

export async function GET(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 7) || 7));
  const sinceTs = new Date(Date.now() - days * 86_400_000);
  const sinceDay = sinceTs.toISOString().slice(0, 10);
  const db = serviceClient();

  const [views, cohort, shared] = await Promise.all([
    db.from("funnel_daily").select("day,event,n").gte("day", sinceDay),
    db.from("users").select("id").gte("created_at", sinceTs.toISOString()).limit(COHORT_CAP),
    db.from("jobs").select("id", { count: "exact", head: true }).in("published_visibility", ["public", "unlisted"]).gte("published_at", sinceTs.toISOString()),
  ]);
  const err = [views, cohort, shared].find((r) => r.error)?.error;
  if (err) return NextResponse.json({ error: "query_failed", detail: err.message }, { status: 502 });

  const ids = (cohort.data ?? []).map((u) => String(u.id));
  let firstSongUsers = 0;
  if (ids.length) {
    const { data, error } = await db.from("jobs").select("user_id").eq("status", "completed").in("user_id", ids).limit(5000);
    if (error) return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 502 });
    firstSongUsers = new Set((data ?? []).map((j) => String(j.user_id))).size;
  }
  return NextResponse.json({
    ...buildFunnel((views.data ?? []) as FunnelRow[], { signups: ids.length, firstSongUsers, shared: shared.count ?? 0 }, days),
    cohort_truncated: ids.length >= COHORT_CAP,
  });
}
