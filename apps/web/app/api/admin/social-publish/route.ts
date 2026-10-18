/**
 * /api/admin/social-publish -- cron (every 15 min) that uploads approved rows of public.social_posts to YouTube,
 * Instagram, Facebook and TikTok. Off unless SOCIAL_PUBLISH_ENABLED=1; see lib/social/publish.ts for the hold rules
 * and docs/SOCIAL-PUBLISHING.md for the design. Auth: Bearer CRON_SECRET / AGENT_TICK_SECRET / ADMIN_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkCronOrAdminBearer } from "../../../../lib/agent/auth";
import { runPublish } from "../../../../lib/social/publish";
import { supabaseStore } from "../../../../lib/social/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!checkCronOrAdminBearer(req.headers.get("authorization")).ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runPublish(supabaseStore(serviceClient())));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
