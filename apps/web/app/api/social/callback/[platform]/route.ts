/**
 * GET /api/social/callback/{platform}: the platform redirects S here after consent. No bearer is possible on a
 * browser redirect, so the HMAC-signed, 10-minute `state` made by the connect route is the credential.
 * Stores the sealed token in public.social_accounts and shows a plain page; no token is ever echoed.
 */
import { NextRequest, NextResponse } from "next/server";

import { serviceClient } from "../../../../../lib/agent/adapters";
import { cleanSecret } from "../../../../../lib/agent/auth";
import { isPlatform } from "../../../../../lib/social/config";
import { seal, verifyState } from "../../../../../lib/social/crypto";
import { ADAPTERS } from "../../../../../lib/social/platforms";
import { siteBase } from "../../../../../lib/social/site";

export const dynamic = "force-dynamic";

const page = (msg: string, status = 200) =>
  new NextResponse(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>neo-fm connect</title><body style="font:16px system-ui;padding:24px;max-width:32rem"><p>${msg}</p><p><a href="/admin/social">Back to publishing</a></p>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });

export async function GET(req: NextRequest, props: { params: Promise<{ platform: string }> }) {
  const params = await props.params;
  if (!isPlatform(params.platform)) return page("Unknown platform.", 404);
  const q = req.nextUrl.searchParams;
  const secret = cleanSecret(process.env.ADMIN_SECRET) || cleanSecret(process.env.CRON_SECRET);
  if (!verifyState(q.get("state") ?? "", params.platform, secret)) return page("This sign-in link expired or is not valid. Start again from the publishing page.", 400);
  const code = q.get("code");
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
