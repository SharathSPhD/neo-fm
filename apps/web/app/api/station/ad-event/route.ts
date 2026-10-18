/**
 * POST /api/station/ad-event {"slotId":"<uuid>","event":"start"|"complete"|"tap"} -- house-ad log (migration 0099).
 * Used for sponsor reporting and the per-day frequency cap only; it never feeds the taste signals. Signed-out listeners
 * are logged without a user id. A no-op unless ADS_ENABLED=1, and always 204 so a missing table never reaches the browser.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { adsEnabled } from "@/lib/station/ads";
import { requireUser } from "@/lib/supabase/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const Body = z.object({ slotId: z.string().uuid(), event: z.enum(["start", "complete", "tap"]) });

export async function POST(req: NextRequest) {
  if (!adsEnabled()) return new NextResponse(null, { status: 204 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const authed = await requireUser();
  const userId = authed instanceof NextResponse ? null : authed.user.id;
  try {
    const admin = createServiceRoleClient();
    await (admin.from as unknown as (t: string) => { insert: (row: object) => Promise<unknown> })("ad_events").insert({
      slot_id: parsed.data.slotId,
      event: parsed.data.event,
      user_id: userId,
    });
  } catch { /* the log is best effort */ }
  return new NextResponse(null, { status: 204 });
}
