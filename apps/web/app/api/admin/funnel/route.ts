/** GET /api/admin/funnel[?days=7] -- funnel counts (Bearer CRON_SECRET / AGENT_TICK_SECRET). Read-only. */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { loadFunnel, OpsQueryError } from "../../../../lib/ops/load";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 7) || 7));
  try {
    return NextResponse.json(await loadFunnel(serviceClient(), days));
  } catch (e) {
    if (e instanceof OpsQueryError) return NextResponse.json({ error: "query_failed", detail: e.message }, { status: 502 });
    throw e;
  }
}
