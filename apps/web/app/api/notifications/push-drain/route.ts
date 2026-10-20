/**
 * GET|POST /api/notifications/push-drain  (Bearer CRON_SECRET / AGENT_TICK_SECRET)
 * Vercel Cron calls this every minute. A no-op until web push is configured
 * (feature flag + VAPID keys, or the app flag + FCM service account), so deploying it changes nothing by default.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkBearer } from "../../../../lib/agent/auth";
import { drainPush } from "../../../../lib/notifications/drain";
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
  if (!cfg && !app) return NextResponse.json({ enabled: false });
  const summary = await drainPush(serviceClient(), cfg, undefined, undefined, app ? { cfg: app } : undefined);
  return NextResponse.json({ enabled: true, ...summary });
}

export const GET = handle;
export const POST = handle;
