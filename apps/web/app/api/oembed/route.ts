/**
 * GET /api/oembed?url=<song url>[&maxwidth=][&maxheight=][&format=json]
 *
 * oEmbed provider for public and unlisted songs. Private, taken-down and
 * unknown songs all return the same 404 so the endpoint cannot be used to
 * probe which ids exist. RLS (anon) already hides private rows; the
 * explicit visibility filter keeps that true even if a policy changes.
 */
import { NextResponse } from "next/server";

import { buildOembed, publicIdFromUrl } from "@/lib/embed/oembed";
import { createServerClient } from "@/lib/supabase/server";
import { prettyLanguage, prettyStyle } from "@/lib/song/labels";

export const dynamic = "force-dynamic";

function intParam(v: string | null): number | null {
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  if (!target) return NextResponse.json({ error: "url_required" }, { status: 400 });
  if ((url.searchParams.get("format") ?? "json") !== "json") {
    return NextResponse.json({ error: "format_not_supported" }, { status: 501 });
  }
  const publicId = publicIdFromUrl(target, url.host);
  if (!publicId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const supabase = createServerClient();
  const { data } = await supabase
    .from("jobs")
    .select("public_id, song_documents ( language, style_family, title )")
    .eq("public_id", publicId)
    .in("published_visibility", ["public", "unlisted"])
    .maybeSingle<{
      public_id: string;
      song_documents: { language: string; style_family: string; title: string | null } | null;
    }>();
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const d = data.song_documents;
  const stored = d?.title?.trim();
  const title = stored
    ? stored
    : d
      ? `${prettyStyle(d.style_family)} song in ${prettyLanguage(d.language)}`
      : "neo-fm song";

  const body = buildOembed({
    origin: url.origin,
    publicId,
    title,
    maxwidth: intParam(url.searchParams.get("maxwidth")),
    maxheight: intParam(url.searchParams.get("maxheight")),
  });
  return NextResponse.json(body, {
    headers: {
      "cache-control": "public, max-age=300, s-maxage=3600",
      "access-control-allow-origin": "*",
    },
  });
}
