/** POST /api/admin/social/connect/{platform} (Bearer ADMIN_SECRET): returns the platform's consent URL for S to open. */
import { NextRequest, NextResponse } from "next/server";

import { checkAdminBearer, cleanSecret } from "../../../../../../lib/agent/auth";
import { isPlatform } from "../../../../../../lib/social/config";
import { signState } from "../../../../../../lib/social/crypto";
import { ADAPTERS } from "../../../../../../lib/social/platforms";
import { siteBase } from "../../../../../../lib/social/site";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, props: { params: Promise<{ platform: string }> }) {
  const params = await props.params;
  if (!checkAdminBearer(req.headers.get("authorization")).ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isPlatform(params.platform)) return NextResponse.json({ error: "unknown platform" }, { status: 404 });
  const adapter = ADAPTERS[params.platform];
  const missing = adapter.missingEnv(process.env);
  if (missing.length) return NextResponse.json({ error: "platform app not configured", missing_env: missing }, { status: 409 });
  const secret = cleanSecret(process.env.ADMIN_SECRET) || cleanSecret(process.env.CRON_SECRET);
  const state = signState(params.platform, secret);
  return NextResponse.json({ url: adapter.authUrl(state, `${siteBase()}/api/social/callback/${params.platform}`, process.env) });
}
