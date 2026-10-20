/**
 * Recognition-only referral. A share link may carry `ref=<handle>` of the sharer, but only a public handle (migration 0023:
 * 3-30 chars of [a-z0-9_]); an email, name or user id is never put in a URL. Listeners without a handle share without one.
 */
const HANDLE_RE = /^[a-z0-9_]{3,30}$/;

export const REF_STORAGE_KEY = "fb:ref";

/** Lower-cased handle, or null when `v` is not a valid public handle. */
export function cleanRef(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const h = v.trim().replace(/^@/, "").toLowerCase();
  return HANDLE_RE.test(h) ? h : null;
}

/** "@handle · neo.fm · AI-generated": the line under a shared clip. */
export function clipBrandLine(handle: string | null | undefined): string {
  const h = cleanRef(handle);
  return h ? `@${h} · neo.fm · AI-generated` : "neo.fm · AI-generated";
}
