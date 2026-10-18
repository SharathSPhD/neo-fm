/**
 * First-touch campaign labels for the anonymous funnel. Only the four utm_* marketing labels are kept, lower-cased and
 * limited to a short slug; they name a campaign, never a person. Counted in funnel_campaign_daily (migration 0104).
 */
export interface Utm { source: string; medium: string; campaign: string; content: string }

const MAX = 40;
const slug = (v: unknown): string =>
  typeof v === "string" ? v.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX) : "";

/** Clean an untrusted object (from the browser or a query string). Null when it names no source or campaign. */
export function cleanUtm(v: unknown): Utm | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const utm = { source: slug(o.source), medium: slug(o.medium), campaign: slug(o.campaign), content: slug(o.content) };
  return utm.source || utm.campaign ? utm : null;
}

export function utmFromSearch(search: string): Utm | null {
  const p = new URLSearchParams(search);
  return cleanUtm({ source: p.get("utm_source"), medium: p.get("utm_medium"), campaign: p.get("utm_campaign"), content: p.get("utm_content") });
}
