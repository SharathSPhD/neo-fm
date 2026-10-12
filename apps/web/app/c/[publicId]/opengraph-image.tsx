/**
 * OG image for /c/[publicId]. Private or unknown collections get the generic
 * neo-fm card, so a private playlist's title never ends up in a cacheable
 * image. Only titles of songs that are themselves published are shown.
 */
import { renderCollectionCard } from "@/lib/collections/card-image";
import { loadPublicCollection } from "@/lib/collections/load";
import { PublicIdSchema } from "@/lib/collections/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "neo-fm playlist";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage(props: { params: Promise<{ publicId: string }> }) {
  const params = await props.params;
  let title = "neo-fm";
  let songTitles: string[] = [];
  let count = 0;
  const check = PublicIdSchema.safeParse(params.publicId);
  if (check.success) {
    const found = await loadPublicCollection(check.data).catch(() => null);
    if (found) {
      title = found.collection.title;
      songTitles = found.songs.map((s) => s.title);
      count = found.songs.length;
    }
  }
  return renderCollectionCard({ title, songTitles, songCount: count, seed: params.publicId });
}
