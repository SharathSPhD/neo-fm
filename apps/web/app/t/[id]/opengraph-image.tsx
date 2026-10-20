/** OG card for /t/[id]: native-script title and language name shaped by the share-card renderer; a generic card when the id does not resolve. */
import { renderShareCard } from "@/lib/share/card-image";
import { trackCardContent } from "@/lib/share/track-card";
import { loadPoolTrack } from "@/lib/station/pool";
import { isTrackId } from "@/lib/station/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "neo-fm song";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const track = isTrackId(id) ? await loadPoolTrack(id) : null;
  if (!track) return renderShareCard({ title: "neo-fm", subtitle: "Your personal FM", excerpt: [], seed: id });
  return renderShareCard({ ...trackCardContent(track), seed: id });
}
