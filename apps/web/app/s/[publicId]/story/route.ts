/**
 * GET /s/[publicId]/story[?download=1] -> 1080x1920 PNG for Instagram /
 * WhatsApp status. Public and unlisted songs only (same gate as the OG
 * image); anything else is a 404. Not indexable.
 */
import { NextResponse, type NextRequest } from "next/server";

import { renderDedicationCard } from "@/lib/share/dedication-image";
import { loadShareSong } from "@/lib/share/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { publicId: string } },
) {
  const song = await loadShareSong(params.publicId);
  if (!song) return new NextResponse("Not found", { status: 404 });

  const origin = request.nextUrl.origin.replace(/^https?:\/\//, "");
  const linkText = `${origin}/s/${song.publicId}`;
  const res = await renderDedicationCard({
    variant: "story",
    to: song.dedication?.to ?? "",
    message: song.dedication?.message ?? null,
    title: song.title,
    seed: song.publicId,
    linkText,
    undedicated: !song.dedication,
  });
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "public, max-age=0, s-maxage=60");
  headers.set("X-Robots-Tag", "noindex");
  if (request.nextUrl.searchParams.get("download")) {
    headers.set(
      "Content-Disposition",
      `attachment; filename="neo-fm-${song.publicId}-story.png"`,
    );
  }
  return new NextResponse(res.body, { status: 200, headers });
}
