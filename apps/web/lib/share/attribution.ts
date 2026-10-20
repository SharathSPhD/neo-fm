/**
 * Attribution for links people share. Every outbound song, track or clip link carries four utm_* labels (the same
 * labels the anonymous funnel keeps, see lib/ops/utm.ts), so a visit that comes from a share is counted per channel in
 * funnel_campaign_daily with no migration. An optional `ref` carries the sharer's public handle (lib/share/referral.ts),
 * never an email or id. The canonical URL stays clean; only the copy that leaves the app is tagged.
 */
import { cleanRef } from "./referral";

export const SHARE_CHANNELS = ["whatsapp", "native", "copy", "clip", "story"] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];
export type ShareKind = "song" | "track" | "clip" | "gift";

export const SHARE_MEDIUM = "share";

/** `url` may be absolute or origin-relative; an existing query string and hash are preserved. */
export function withShareUtm(url: string, channel: ShareChannel, kind: ShareKind, ref?: string | null): string {
  const hash = url.indexOf("#");
  const base = hash === -1 ? url : url.slice(0, hash);
  const tail = hash === -1 ? "" : url.slice(hash);
  const q = base.indexOf("?");
  const path = q === -1 ? base : base.slice(0, q);
  const params = new URLSearchParams(q === -1 ? "" : base.slice(q + 1));
  params.set("utm_source", channel);
  params.set("utm_medium", SHARE_MEDIUM);
  params.set("utm_campaign", `share-${kind}`);
  // The sharer's public handle, when they have one; shown to the visitor as "shared by @handle".
  const handle = cleanRef(ref);
  if (handle) params.set("ref", handle);
  else params.delete("ref");
  return `${path}?${params.toString()}${tail}`;
}
