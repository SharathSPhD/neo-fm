/**
 * POST /api/station/signal {"trackId","kind","positionMs"?} -- one listener signal from /station.
 * Own-row log (migration 0094, service-role writes after we authenticate). Degrades to 204 when the table is not there
 * yet so a missing migration never breaks playback.
 */
import { NextResponse } from "next/server";

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
  try {
    await (createServiceRoleClient().from as unknown as (t: string) => { insert: (r: object) => Promise<unknown> })(
      "station_signals",
    ).insert({ user_id: authed.user.id, track_id: sig.trackId, kind: sig.kind, position_ms: sig.positionMs });
  } catch { /* the log is best effort */ }
  return new NextResponse(null, { status: 204 });
}
