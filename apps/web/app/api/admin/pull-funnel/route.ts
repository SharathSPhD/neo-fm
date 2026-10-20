/**
 * GET /api/admin/pull-funnel[?days=14] -- visit, first play, signup, return day 1 and day 7 for the signup cohort
 * (Bearer CRON_SECRET / AGENT_TICK_SECRET). Aggregates only, read-only.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { loadPullFunnel, OpsQueryError } from "../../../../lib/ops/load";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const days = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 14) || 14));
  try {
    return NextResponse.json(await loadPullFunnel(serviceClient(), days));
  } catch (e) {
    if (e instanceof OpsQueryError) return NextResponse.json({ error: "query_failed", detail: e.message }, { status: 502 });
    throw e;
  }
}
