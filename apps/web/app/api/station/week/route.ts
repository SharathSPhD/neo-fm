/**
 * GET /api/station/week -- "your week on neo-fm": the signed-in listener's own last seven days on the station, recomputed on
 * request from station_signals (nothing stored). Off (404) unless STATION_WEEK=1. Private: never cached, only the caller's rows.
 */
import { NextResponse } from "next/server";

import { getLogger } from "@/lib/obs/log";
import { weekEnabled } from "@/lib/station/week";
import { loadWeek } from "@/lib/station/week-load";
import { requireUser } from "@/lib/supabase/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!weekEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  try {
    const week = await loadWeek(createServiceRoleClient() as never, authed.user.id);
    return NextResponse.json({ week }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    getLogger("api/station/week", req).warn("week failed", { reason: e instanceof Error ? e.message : "unknown" });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
