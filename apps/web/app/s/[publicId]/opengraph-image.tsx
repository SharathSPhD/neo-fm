/**
 * Dynamic OG image for /s/[publicId] (1200x630, PNG). Uses Next's
 * ImageResponse; lyric lines are shaped with HarfBuzz (see lib/share).
 *
 * A dedicated song gets the dedication card instead of the lyric card.
 * Falls back to a generic "neo-fm" card if the publicId doesn't resolve
 * or the song has been re-privatized.
 */
import { renderDedicationCard } from "@/lib/share/dedication-image";
import { renderShareCard } from "@/lib/share/card-image";
import { loadShareSong } from "@/lib/share/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "neo-fm song";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage(props: {
  params: Promise<{ publicId: string }>;
}) {
  const params = await props.params;
  const song = await loadShareSong(params.publicId);
  if (!song) {
    return renderShareCard({
      title: "neo-fm",
      subtitle: "AI music, India-first",
      excerpt: [],
      seed: params.publicId,
    });
  }
  if (song.dedication) {
    return renderDedicationCard({
      variant: "og",
      to: song.dedication.to,
      message: song.dedication.message,
      title: song.title,
      seed: song.publicId,
    });
  }
  return renderShareCard({
    title: song.title,
    subtitle: song.subtitle,
    excerpt: song.excerpt,
    seed: song.publicId,
  });
}
