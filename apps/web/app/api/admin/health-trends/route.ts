/** GET /api/admin/health-trends[?days=7|30] -- daily points from stored snapshots, oldest first. Read-only. */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkBearer } from "../../../../lib/agent/auth";
import { buildTrend, type SnapshotRow } from "../../../../lib/ops/snapshot";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const auth = checkBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 7) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await serviceClient().from("health_snapshots").select("day,summary,funnel").gte("day", since).order("day", { ascending: true }).limit(90);
  if (error) return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 502 });
  return NextResponse.json({ days, points: buildTrend((data ?? []) as SnapshotRow[]) });
}
