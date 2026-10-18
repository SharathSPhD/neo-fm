/**
 * /api/admin/provider-cap (Bearer ADMIN_SECRET via checkAdminBearer) -- the shared per-day request counter for Lyria, Veo and TTS.
 *   GET ?provider=lyria            today's counts and limits (Pacific day, matching the providers' midnight PT reset)
 *   POST {provider, class:"batch"} counts ONE request and answers {ok:boolean}; scripts that call a paid provider outside this app
 *                                  (pool renders, media lab, Veo, TTS) call it right before each request and stop on ok:false.
 * Limits: lyria 450/day with batch callers stopping at 250 (200 kept for listeners' songs), veo 9, tts 90 (90% of the provider caps).
 * Only the "batch" class is accepted here; listeners' songs are counted inside the render path.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { dailyCap, dailyUsage, type CapProvider } from "../../../../lib/ops/provider-cap";

export const dynamic = "force-dynamic";

const PROVIDERS: readonly CapProvider[] = ["lyria", "veo", "tts"];
const asProvider = (v: unknown): CapProvider | null => (PROVIDERS.includes(v as CapProvider) ? (v as CapProvider) : null);

export async function GET(req: NextRequest) {
  if (!checkAdminBearer(req.headers.get("authorization")).ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const one = asProvider(req.nextUrl.searchParams.get("provider"));
  const db = serviceClient();
  const usage = await Promise.all((one ? [one] : PROVIDERS).map((p) => dailyUsage(db, p)));
  return NextResponse.json({ usage });
}

export async function POST(req: NextRequest) {
  if (!checkAdminBearer(req.headers.get("authorization")).ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { provider?: unknown; class?: unknown } | null;
  const provider = asProvider(body?.provider);
  if (!provider || body?.class !== "batch") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const ok = await dailyCap(serviceClient(), provider, "batch").reserve();
  return NextResponse.json({ ok }, { status: ok ? 200 : 429 });
}
