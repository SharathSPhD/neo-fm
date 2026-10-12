/**
 * POST /api/events {"event":"landing_view"} -- anonymous page-view counter (migration 0071).
 * Stores only a per-day count. Requests carrying DNT or Sec-GPC are acknowledged but not counted.
 * Always answers 204 so a missing migration or a hiccup never surfaces in the visitor's browser.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../lib/agent/adapters";
import { isFunnelEvent, optedOut } from "../../../lib/ops/funnel";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (optedOut(req.headers)) return new NextResponse(null, { status: 204 });
  let event: unknown;
  try { event = (await req.json())?.event; } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  if (!isFunnelEvent(event)) return NextResponse.json({ error: "unknown_event" }, { status: 400 });
  try { await serviceClient().rpc("bump_funnel", { p_event: event }); } catch { /* counters are best effort */ }
  return new NextResponse(null, { status: 204 });
}
