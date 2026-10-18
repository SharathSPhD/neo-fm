/** Share links for station pool tracks: one public page per track, so a shared link plays that track. */
import { siteUrl } from "@/lib/seo/site";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isTrackId = (id: string) => UUID_RE.test(id);

/** `origin` defaults to the canonical site URL; the client passes location.origin so previews share previews. */
export function trackShareUrl(id: string, origin: string = siteUrl()): string {
  return `${origin.replace(/\/+$/, "")}/t/${id}`;
}

export function whatsappShareUrl(title: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${title} on neo-fm. Listen: ${url}`)}`;
}
