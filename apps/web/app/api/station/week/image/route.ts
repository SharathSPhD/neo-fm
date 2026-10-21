/**
 * GET /api/station/week/image?lang=hi[&download=1] -- 1080x1920 "your week on neo-fm" story image for the signed-in listener.
 * Private on purpose: built from the caller's own signals, never cached by shared caches. Off (404) unless STATION_WEEK=1.
 */
import { NextResponse, type NextRequest } from "next/server";

import { isUiLang } from "@/lib/i18n/ui-strings";
import { getLogger } from "@/lib/obs/log";
import { weekEnabled } from "@/lib/station/week";
import { renderWeekStory } from "@/lib/station/week-image";
import { loadWeek } from "@/lib/station/week-load";
import { requireUser } from "@/lib/supabase/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!weekEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const q = request.nextUrl.searchParams;
  const langParam = q.get("lang");
  const lang = isUiLang(langParam) ? langParam : "en";
  try {
    const week = await loadWeek(createServiceRoleClient() as never, authed.user.id);
    const res = await renderWeekStory({ week, lang });
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Robots-Tag", "noindex");
    if (q.get("download")) headers.set("Content-Disposition", 'attachment; filename="neo-fm-week.png"');
    return new NextResponse(res.body, { status: 200, headers });
  } catch (e) {
    getLogger("api/station/week/image", request).warn("week image failed", { reason: e instanceof Error ? e.message : "unknown" });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
