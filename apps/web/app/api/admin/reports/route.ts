/**
 * GET /api/admin/reports -- open abuse reports grouped per song, most-reported first (Bearer CRON_SECRET / AGENT_TICK_SECRET).
 * Resolve with POST /api/admin/reports/resolve.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { listQueue } from "../../../../lib/moderation/reports";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!checkAdminBearer(req.headers.get("authorization")).ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const items = await listQueue(serviceClient());
    return NextResponse.json({ open_songs: items.length, items });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "queue_failed" }, { status: 500 });
  }
}
