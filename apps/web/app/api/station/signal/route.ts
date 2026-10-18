/**
 * POST /api/station/signal {"trackId","kind","positionMs"?} -- one listener signal from /station.
 * Own-row log (migration 0094, service-role writes after we authenticate). Always 204 so playback never breaks; a failed insert is logged.
 */
import { NextResponse } from "next/server";

import { getLogger } from "@/lib/obs/log";
import { insertSignal, type SignalInsertClient } from "@/lib/station/signal-store";
import { parseSignal } from "@/lib/station/signals";
import { requireUser } from "@/lib/supabase/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const sig = parseSignal(body);
  if (!sig) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  // Still 204 on failure so playback never breaks, but the failure is now logged instead of vanishing.
  const res = await insertSignal(createServiceRoleClient() as unknown as SignalInsertClient, authed.user.id, sig);
  if (!res.ok) getLogger("api/station/signal", req).warn("station signal not stored", { reason: res.reason, kind: sig.kind });
  return new NextResponse(null, { status: 204 });
}
