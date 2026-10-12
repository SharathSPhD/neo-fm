/**
 * GET /api/admin/client-errors[?hours=24] -- recent browser errors grouped by
 * fingerprint, for the "Recent errors" panel on /admin/health. Read-only,
 * Bearer CRON_SECRET / AGENT_TICK_SECRET like the other admin endpoints.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { groupClientErrors, type StoredClientError } from "../../../../lib/obs/group-errors";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const ROW_CAP = 1000;

export async function GET(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const hours = Math.min(168, Math.max(1, Number(req.nextUrl.searchParams.get("hours") ?? 24) || 24));
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data, error } = await serviceClient()
    .from("client_errors")
    .select("created_at,fingerprint,name,message,route,boundary,lang,ua_family,request_id")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(ROW_CAP);
  if (error) return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 502 });
  const rows = (data ?? []) as StoredClientError[];
  return NextResponse.json({
    hours,
    total: rows.length,
    truncated: rows.length >= ROW_CAP,
    groups: groupClientErrors(rows).slice(0, 50),
  });
}
