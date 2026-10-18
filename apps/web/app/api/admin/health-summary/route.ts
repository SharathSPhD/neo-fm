/**
 * GET /api/admin/health-summary[?hours=24][&format=text]
 * Read-only ops snapshot for the daily routine (Bearer CRON_SECRET / AGENT_TICK_SECRET). Never writes.
 * Job rows are capped, so on a very busy window the counts are a floor, flagged by `truncated`.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { alertString } from "../../../../lib/ops/health-summary";
import { loadHealthSummary, OpsQueryError } from "../../../../lib/ops/load";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const hours = Math.min(168, Math.max(1, Number(p.get("hours") ?? 24) || 24));
  try {
    const summary = await loadHealthSummary(serviceClient(), hours);
    if (p.get("format") === "text") {
      return new NextResponse(alertString(summary) + (summary.truncated ? " (truncated)" : "") + "\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return NextResponse.json({ ...summary, text: alertString(summary) });
  } catch (e) {
    if (e instanceof OpsQueryError) return NextResponse.json({ error: "query_failed", detail: e.message }, { status: 502 });
    throw e;
  }
}
