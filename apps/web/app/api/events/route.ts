/**
 * POST /api/events {"event":"landing_view"} -- anonymous page-view counter (migration 0071).
 * Stores only a per-day count. Requests carrying DNT or Sec-GPC are acknowledged but not counted.
 * Optional `utm` ({source,medium,campaign,content}, first touch) also counts per campaign. Always answers 204 so a missing migration or a hiccup never surfaces in the visitor's browser.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../lib/agent/adapters";
import { isFunnelEvent, optedOut } from "../../../lib/ops/funnel";
import { cleanUtm } from "../../../lib/ops/utm";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (optedOut(req.headers)) return new NextResponse(null, { status: 204 });
  let event: unknown;
  let utm: ReturnType<typeof cleanUtm> = null;
  try { const body = await req.json(); event = body?.event; utm = cleanUtm(body?.utm); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  if (!isFunnelEvent(event)) return NextResponse.json({ error: "unknown_event" }, { status: 400 });
  const db = serviceClient();
  try { await db.rpc("bump_funnel", { p_event: event }); } catch { /* counters are best effort */ }
  // Campaign counter (migration 0104). Missing function or table: the plain count above already happened.
  if (utm) {
    try {
      await (db as unknown as { rpc: (fn: string, a: Record<string, string>) => Promise<unknown> }).rpc("bump_funnel_campaign", {
        p_event: event, p_source: utm.source, p_medium: utm.medium, p_campaign: utm.campaign, p_content: utm.content,
      });
    } catch { /* best effort */ }
  }
  return new NextResponse(null, { status: 204 });
}
