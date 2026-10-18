/** OG card for /station: the station pitch on the shared share-card renderer, so a pasted link previews well. */
import { renderShareCard } from "@/lib/share/card-image";

export const runtime = "nodejs";
export const alt = "neo-fm: your personal 24/7 FM station";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage() {
  return renderShareCard({
    title: "Your personal 24/7 FM station",
    subtitle: "Music tuned to your taste. AI-made, in Indian languages first.",
    excerpt: [],
    seed: "neo-fm-station",
  });
}
