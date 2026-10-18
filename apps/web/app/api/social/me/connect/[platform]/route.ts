/**
 * POST   /api/social/me/connect/{platform}: returns the platform's consent URL for the signed-in listener.
 *   body { mode?: "neofm_app" | "own_app", clientId?, clientSecret? }. own_app is for Creator and Pro and seals the
 *   listener's own developer-app credentials first; the callback then exchanges the code with those.
 * DELETE /api/social/me/connect/{platform}: forget the connection and any sealed own-app credentials.
 */
import { NextRequest, NextResponse } from "next/server";

import { serviceClient } from "../../../../../../lib/agent/adapters";
import { cleanSecret } from "../../../../../../lib/agent/auth";
import type { UserTier } from "../../../../../../lib/agent/tiers";
import { isPlatform } from "../../../../../../lib/social/config";
import { signState } from "../../../../../../lib/social/crypto";
import { canUseOwnApp, envWithApp, listenerSocialEnabled } from "../../../../../../lib/social/listener/config";
import { removeConnection, saveOwnApp } from "../../../../../../lib/social/listener/store";
import { ADAPTERS } from "../../../../../../lib/social/platforms";
import { siteBase } from "../../../../../../lib/social/site";
import { requireUser } from "../../../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ platform: string }> };

export async function POST(req: NextRequest, props: Ctx) {
  const { platform } = await props.params;
  if (!listenerSocialEnabled()) return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  if (!isPlatform(platform)) return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { user, supabase } = authed;

  const body = (await req.json().catch(() => ({}))) as { mode?: string; clientId?: unknown; clientSecret?: unknown };
  const mode = body.mode === "own_app" ? "own_app" : "neofm_app";
  const stateSecret = cleanSecret(process.env.ADMIN_SECRET) || cleanSecret(process.env.CRON_SECRET);
  if (!stateSecret || !process.env.SOCIAL_TOKEN_KEY) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const redirectUri = `${siteBase()}/api/social/callback/${platform}`;
  const adapter = ADAPTERS[platform];

  let env = process.env;
  if (mode === "own_app") {
    const { data: profile } = await supabase.from("users").select("tier").eq("id", user.id).single();
    if (!canUseOwnApp((profile?.tier ?? "free") as UserTier)) return NextResponse.json({ error: "own_app_requires_creator_or_pro" }, { status: 403 });
    const id = typeof body.clientId === "string" ? body.clientId.trim() : "";
    const secret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";
    if (!id || !secret || id.length > 300 || secret.length > 300) return NextResponse.json({ error: "client_id_and_secret_required" }, { status: 400 });
    if (!(await saveOwnApp(serviceClient(), user.id, platform, id, secret))) return NextResponse.json({ error: "unavailable" }, { status: 503 });
    env = envWithApp(process.env, platform, id, secret);
  } else {
    const missing = adapter.missingEnv(process.env);
    if (missing.length) return NextResponse.json({ error: "platform_not_configured" }, { status: 409 });
  }
  const state = signState(platform, stateSecret, Date.now(), 10 * 60_000, { u: user.id, m: mode });
  return NextResponse.json({ url: adapter.authUrl(state, redirectUri, env), redirect_uri: redirectUri });
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { platform } = await props.params;
  if (!listenerSocialEnabled()) return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  if (!isPlatform(platform)) return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  await removeConnection(serviceClient(), authed.user.id, platform);
  return NextResponse.json({ ok: true });
}
