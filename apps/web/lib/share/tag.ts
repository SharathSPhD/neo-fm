/**
 * Source tags for outgoing share links. Every link a listener sends carries utm_source (where it was sent from),
 * utm_medium=share and utm_campaign (what was shared), which the funnel already counts on arrival (lib/ops/utm.ts).
 * `ref` is the sender's referral code (8 lowercase base32 characters, issued by the referral loop); it is added only when
 * the caller has one, and a malformed value is dropped rather than sent.
 */
export type ShareSource = "whatsapp" | "copy" | "shorts" | "instagram" | "sheet";
export type ShareCampaign = "clip" | "station" | "gift" | "together";

const REF_RE = /^[a-z2-7]{8}$/;

export function tagShareUrl(url: string, opts: { source: ShareSource; campaign: ShareCampaign; ref?: string | null }): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  u.searchParams.set("utm_source", opts.source);
  u.searchParams.set("utm_medium", "share");
  u.searchParams.set("utm_campaign", opts.campaign);
  if (opts.ref && REF_RE.test(opts.ref)) u.searchParams.set("ref", opts.ref);
  return u.toString();
}
