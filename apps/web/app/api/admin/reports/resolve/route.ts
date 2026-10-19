/**
 * POST /api/admin/reports/resolve { job_id | pool_track_id, action: "takedown" | "dismiss" | "reinstate", note? } (Bearer CRON_SECRET / AGENT_TICK_SECRET).
 *   takedown  -> song made private + flagged so the owner cannot re-publish; open reports closed as actioned; owner and reporters emailed.
 *   dismiss   -> open reports closed as dismissed; reporters emailed.
 *   reinstate -> lifts the publish block (appeal outcome); the owner decides whether to publish again.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../../lib/agent/auth";
import { resendMailer } from "../../../../../lib/email/moderation";
import { resolveJobReports, resolvePoolReports, type ResolveAction } from "../../../../../lib/moderation/reports";

export const dynamic = "force-dynamic";

const ACTIONS: readonly string[] = ["takedown", "dismiss", "reinstate"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  if (!checkAdminBearer(req.headers.get("authorization")).ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { job_id?: unknown; pool_track_id?: unknown; action?: unknown; note?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (typeof body.pool_track_id === "string" && UUID.test(body.pool_track_id) && (body.action === "takedown" || body.action === "dismiss")) {
    const r = await resolvePoolReports(serviceClient(), { poolTrackId: body.pool_track_id, action: body.action, note: typeof body.note === "string" ? body.note : undefined });
    if (!r.ok) return NextResponse.json({ error: r.error, detail: r.detail }, { status: r.error === "not_found" ? 404 : 500 });
    return NextResponse.json(r);
  }
  if (typeof body.job_id !== "string" || !UUID.test(body.job_id) || typeof body.action !== "string" || !ACTIONS.includes(body.action)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const res = await resolveJobReports(serviceClient(), resendMailer(), {
    jobId: body.job_id, action: body.action as ResolveAction, note: typeof body.note === "string" ? body.note : undefined,
  });
  if (!res.ok) return NextResponse.json({ error: res.error, detail: res.detail }, { status: res.error === "not_found" ? 404 : 500 });
  return NextResponse.json(res);
}
