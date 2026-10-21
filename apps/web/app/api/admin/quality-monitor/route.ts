/**
 * GET /api/admin/quality-monitor?days=14 -- prod quality by day, language, tier and harness arm (read-only, no spend).
 * Bearer admin secret (the operator pastes it on /admin/quality). Computed on request from agent_runs and job_telemetry; no table, no migration.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { loadQualityRows, summarizeQuality } from "../../../../lib/ops/quality-monitor";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const days = Math.max(1, Math.min(30, Number(req.nextUrl.searchParams.get("days") ?? 14) || 14));
  try {
    const { rows, truncated } = await loadQualityRows(serviceClient(), days);
    return NextResponse.json({ ...summarizeQuality(rows, days), truncated });
  } catch (e) {
    return NextResponse.json({ error: "query_failed", detail: (e as Error).message }, { status: 502 });
  }
}
