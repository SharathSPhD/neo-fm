/**
 * Default OG card for every route that does not ship its own (home, pricing, discover and the rest of the marketing
 * pages). Routes with their own opengraph-image (station, language pages, shared songs) override it.
 */
import { renderShareCard } from "@/lib/share/card-image";

export const runtime = "nodejs";
export const alt = "neo-fm: your personal FM, in your language";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage() {
  return renderShareCard({
    title: "neo-fm",
    subtitle: "Your personal 24/7 FM. Music made for you, in Indian languages first.",
    excerpt: [],
    seed: "neo-fm",
  });
}
