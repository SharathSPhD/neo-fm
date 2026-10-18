/**
 * GET /api/social/callback/{platform}: the platform redirects S here after consent. No bearer is possible on a
 * browser redirect, so the HMAC-signed, 10-minute `state` made by the connect route is the credential.
 * Stores the sealed token in public.social_accounts and shows a plain page; no token is ever echoed.
 * A state minted for a listener (carries the user id) stores to public.user_social_accounts instead, using that
 * listener's own developer app when they chose one.
 */
import { NextRequest, NextResponse } from "next/server";

import { serviceClient } from "../../../../../lib/agent/adapters";
import { cleanSecret } from "../../../../../lib/agent/auth";
import { isPlatform } from "../../../../../lib/social/config";
import { readState, seal } from "../../../../../lib/social/crypto";
import { ADAPTERS } from "../../../../../lib/social/platforms";
import { envWithApp, listenerSocialEnabled } from "../../../../../lib/social/listener/config";
import { loadOwnApp, saveConnection } from "../../../../../lib/social/listener/store";
import { siteBase } from "../../../../../lib/social/site";

export const dynamic = "force-dynamic";

const page = (msg: string, status = 200, back = { href: "/admin/social", label: "Back to publishing" }) =>
  new NextResponse(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>neo-fm connect</title><body style="font:16px system-ui;padding:24px;max-width:32rem"><p>${msg}</p><p><a href="${back.href}">${back.label}</a></p>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });

export async function GET(req: NextRequest, props: { params: Promise<{ platform: string }> }) {
  const params = await props.params;
  if (!isPlatform(params.platform)) return page("Unknown platform.", 404);
  const q = req.nextUrl.searchParams;
  const secret = cleanSecret(process.env.ADMIN_SECRET) || cleanSecret(process.env.CRON_SECRET);
  const st = readState(q.get("state") ?? "", params.platform, secret);
  if (!st) return page("This sign-in link expired or is not valid. Start again.", 400);
  const listener = { href: "/account", label: "Back to your account" };
  const code = q.get("code");
  if (st.u) {
    if (!listenerSocialEnabled()) return page("Connecting accounts is not available yet.", 404, listener);
    if (!code) return page("The platform did not return a code (you may have cancelled).", 400, listener);
    try {
      const db = serviceClient();
      let env = process.env;
      if (st.m === "own_app") {
        const app = await loadOwnApp(db, st.u, params.platform);
        if (!app) return page("Your developer app details were not found. Start again.", 400, listener);
        env = envWithApp(process.env, params.platform, app.clientId, app.clientSecret);
      }
      const seed = await ADAPTERS[params.platform].exchange(code, `${siteBase()}/api/social/callback/${params.platform}`, env, fetch);
      if (!(await saveConnection(db, st.u, params.platform, st.m === "own_app" ? "own_app" : "neofm_app", seed))) return page("Connected, but saving failed. Please try again later.", 500, listener);
      return page(`Connected ${params.platform}: ${seed.label.replace(/[<>&]/g, "")}.`, 200, listener);
    } catch (e) {
      return page(`Could not connect: ${(e instanceof Error ? e.message : "error").replace(/[<>&]/g, "").slice(0, 200)}`, 502, listener);
    }
  }
  if (!code) return page("The platform did not return a code (you may have cancelled).", 400);
  try {
    const seed = await ADAPTERS[params.platform].exchange(code, `${siteBase()}/api/social/callback/${params.platform}`, process.env, fetch);
    const { error } = await serviceClient()
      .from("social_accounts")
      .upsert({ platform: params.platform, label: seed.label, secret_sealed: seal(seed.secret), extra: seed.extra, connected_at: new Date().toISOString() });
    if (error) return page("Connected, but saving failed: social_accounts is not migrated yet (0103).", 500);
    return page(`Connected ${params.platform}: ${seed.label.replace(/[<>&]/g, "")}.`);
  } catch (e) {
    return page(`Could not connect: ${(e instanceof Error ? e.message : "error").replace(/[<>&]/g, "").slice(0, 200)}`, 502);
  }
}
