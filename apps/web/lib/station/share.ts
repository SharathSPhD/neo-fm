/** Share links for station pool tracks: one public page per track, so a shared link plays that track. */
import { withShareUtm, type ShareChannel } from "@/lib/share/attribution";
import { siteUrl } from "@/lib/seo/site";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isTrackId = (id: string) => UUID_RE.test(id);

/** `origin` defaults to the canonical site URL; the client passes location.origin so previews share previews. */
export function trackShareUrl(id: string, origin: string = siteUrl()): string {
  return `${origin.replace(/\/+$/, "")}/t/${id}`;
}

/** The link inside the message is tagged for the WhatsApp channel; `url` is the clean track URL. */
export function whatsappShareUrl(title: string, url: string, ref?: string | null): string {
  return `https://wa.me/?text=${encodeURIComponent(`${title} on neo-fm. Listen: ${withShareUtm(url, "whatsapp", "track", ref)}`)}`;
}

/** Track link as it leaves the app for a channel (native sheet or copy). */
export function trackShareLink(id: string, channel: ShareChannel, origin: string = siteUrl(), ref?: string | null): string {
  return withShareUtm(trackShareUrl(id, origin), channel, "track", ref);
}
