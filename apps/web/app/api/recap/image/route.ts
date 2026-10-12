/**
 * GET /api/recap/image?month=YYYY-MM&lang=hi[&download=1]
 *
 * 1080x1920 "my month in music" story image for the signed-in user. Private on purpose: it is built from the
 * caller's own data, so it needs a session and is never cached by shared caches. The user shares the downloaded
 * file themselves.
 */
import { NextResponse, type NextRequest } from "next/server";

import { isUiLang } from "@/lib/i18n/ui-strings";
import { currentMonth, monthRange } from "@/lib/recap/compute";
import { renderRecapStory } from "@/lib/recap/image";
import { loadRecap } from "@/lib/recap/load";
import { requireUser } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;

  const q = request.nextUrl.searchParams;
  const range = monthRange(q.get("month") ?? currentMonth());
  if (!range) return NextResponse.json({ error: "invalid_month" }, { status: 400 });
  const langParam = q.get("lang");
  const lang = isUiLang(langParam) ? langParam : "en";

  let recap;
  try {
    recap = await loadRecap(authed.supabase as never, authed.user.id, range);
  } catch (e) {
    console.error("recap image failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "recap_failed" }, { status: 500 });
  }
  const res = await renderRecapStory({ recap, month: range.month, lang });
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex");
  if (q.get("download")) {
    headers.set("Content-Disposition", `attachment; filename="neo-fm-${range.month}-recap.png"`);
  }
  return new NextResponse(res.body, { status: 200, headers });
}
