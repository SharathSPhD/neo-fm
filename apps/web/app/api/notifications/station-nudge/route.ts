/**
 * GET|POST /api/notifications/station-nudge  (Bearer CRON_SECRET / AGENT_TICK_SECRET)
 * Vercel Cron calls this once a day. A no-op unless STATION_NUDGE_ENABLED=1 and web push or native (FCM) push is configured.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkBearer } from "../../../../lib/agent/auth";
import { runStationNudge, stationNudgeEnabled } from "../../../../lib/notifications/nudge";
import { fcmConfig } from "../../../../lib/notifications/fcm";
import { pushConfig } from "../../../../lib/notifications/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(req: NextRequest) {
  if (!checkBearer(req.headers.get("authorization")).ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const cfg = pushConfig();
  const app = fcmConfig();
  if (!stationNudgeEnabled() || (!cfg && !app)) return NextResponse.json({ enabled: false });
  const summary = await runStationNudge(serviceClient(), cfg, undefined, undefined, app ? { cfg: app } : undefined);
  return NextResponse.json({ enabled: true, ...summary });
}

export const GET = handle;
export const POST = handle;
