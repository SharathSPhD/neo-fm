/** OG card for /t/[id]: title and language on the shared share-card renderer; a generic card when the id does not resolve. */
import { renderShareCard } from "@/lib/share/card-image";
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
  return renderShareCard({
    title: track?.title ?? "neo-fm",
    subtitle: track ? "AI-made music on neo-fm" : "Your personal FM",
    excerpt: [],
    seed: id,
  });
}
