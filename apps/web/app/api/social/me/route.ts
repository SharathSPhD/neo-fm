/** GET /api/social/me: the signed-in listener's connection status. Labels and modes only, never tokens. */
import { NextResponse } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import type { UserTier } from "../../../../lib/agent/tiers";
import { PLATFORMS } from "../../../../lib/social/config";
import { canUseOwnApp, listenerSocialEnabled, shareRoute } from "../../../../lib/social/listener/config";
import { listConnections } from "../../../../lib/social/listener/store";
import { ADAPTERS } from "../../../../lib/social/platforms";
import { requireUser } from "../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!listenerSocialEnabled()) return NextResponse.json({ enabled: false });
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { user, supabase } = authed;
  const { data: profile } = await supabase.from("users").select("tier").eq("id", user.id).single();
  const tier = (profile?.tier ?? "free") as UserTier;
  const conns = await listConnections(serviceClient(), user.id);
  const list = conns === "unavailable" ? [] : conns;
  return NextResponse.json({
    enabled: true,
    ready: conns !== "unavailable",
    own_app_allowed: canUseOwnApp(tier),
    platforms: PLATFORMS.map((platform) => {
      const c = list.find((x) => x.platform === platform);
      return {
        platform,
        route: shareRoute(platform),
        neofm_app_ready: ADAPTERS[platform].missingEnv(process.env).length === 0,
        connected: !!c,
        mode: c?.mode ?? null,
        label: c?.label ?? null,
      };
    }),
  });
}
