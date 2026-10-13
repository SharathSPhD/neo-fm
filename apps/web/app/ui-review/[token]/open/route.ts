/** GET /ui-review/[token]/open?path=/pricing -- sets the reviewer's UI language cookie, then opens a public page in it. */
import { NextResponse, type NextRequest } from "next/server";

import { UI_LANG_COOKIE } from "../../../../lib/i18n/ui-strings";
import { OPENABLE_PATHS } from "../../../../lib/ui-review/core";
import { resolveReviewer } from "../../../../lib/ui-review/load";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const reviewer = await resolveReviewer(params.token);
  if (!reviewer) return new NextResponse("Not found", { status: 404 });
  const path = req.nextUrl.searchParams.get("path") ?? "/";
  if (!OPENABLE_PATHS.includes(path)) return new NextResponse("Bad path", { status: 400 });
  const res = NextResponse.redirect(new URL(path, req.url));
  res.cookies.set(UI_LANG_COOKIE, reviewer.language, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
