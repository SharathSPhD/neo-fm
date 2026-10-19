/**
 * GET|POST /api/notifications/station-nudge  (Bearer CRON_SECRET / AGENT_TICK_SECRET)
 * Vercel Cron calls this once a day. A no-op unless STATION_NUDGE_ENABLED=1 and web push is configured.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkBearer } from "../../../../lib/agent/auth";
import { runStationNudge, stationNudgeEnabled } from "../../../../lib/notifications/nudge";
import { pushConfig } from "../../../../lib/notifications/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(req: NextRequest) {
  if (!checkBearer(req.headers.get("authorization")).ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const cfg = pushConfig();
  if (!stationNudgeEnabled() || !cfg) return NextResponse.json({ enabled: false });
  const summary = await runStationNudge(serviceClient(), cfg);
  return NextResponse.json({ enabled: true, ...summary });
}

export const GET = handle;
export const POST = handle;
