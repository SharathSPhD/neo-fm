/**
 * House-ad / sponsor slots in the station queue (strategy/ads-revenue.md section 8; migration 0099).
 * Pure rules: which slot may play, where it may sit in the queue, and the frequency caps. The queue route does the
 * I/O. Ads are off unless ADS_ENABLED=1, never reach paid listeners, and never touch the taste signals.
 */
import { daypartOf } from "./program";

export interface AdSlot {
  id: string;
  kind: "house" | "sponsor";
  sponsorName: string | null;
  headline: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  audioPath: string | null;
  durationSeconds: number | null;
  /** Empty means any language / any daypart. */
  languages: string[];
  dayparts: string[];
  excludedTags: string[];
  aiMade: boolean;
  weight: number;
  startAt: string | null;
  endAt: string | null;
  active: boolean;
  reviewedAt: string | null;
}

/** All tunable in one place (ads-revenue.md section 6). */
export const AD_CAPS = {
  /** Tracks of the session heard before the first break. */
  firstBreakAfterTracks: 2,
  /** Tracks between two breaks. */
  tracksBetweenBreaks: 5,
  minGapMs: 90_000,
  maxSecondsPer10Min: 6,
  maxPerDay: 8,
  maxPerCreativePerDay: 3,
  /** A card-only spot still holds the screen this long, and counts that much toward the seconds cap. */
  cardOnlySeconds: 6,
} as const;

/** No ad plays next to a track carrying any of these (ads-revenue.md A2). */
export const NEVER_NEXT_TO = ["devotional", "bhajan", "prayer", "qawwali"];
/** No ad plays directly after a track carrying any of these. */
export const NEVER_AFTER = ["sad", "mourning", "farewell"];

export function adsEnabled(): boolean {
  return process.env.ADS_ENABLED === "1";
}

/** Seconds a spot occupies, for the cap. */
export function spotSeconds(slot: Pick<AdSlot, "durationSeconds">): number {
  return slot.durationSeconds ?? AD_CAPS.cardOnlySeconds;
}

export interface AdContext {
  enabled: boolean;
  /** Paid tiers (Creator, Pro, an active subscription) never hear ads. */
  paid: boolean;
  /** The language the listener locked to, or null for the open station. */
  language: string | null;
  hour: number;
  now: number;
  /** Tracks started in this session before the queue slice being built. */
  played: number;
  /** Tracks started since the last break (equals `played` when there has been none). */
  sinceBreak: number;
  /** Null when no break has played yet. */
  lastBreakAgeMs: number | null;
  adSecondsLast10Min: number;
  adsToday: number;
  perCreativeToday: Record<string, number>;
}

/** Slots that may be served at all right now, before the caps. */
export function eligibleSlots(slots: AdSlot[], ctx: Pick<AdContext, "language" | "hour" | "now">): AdSlot[] {
  const part = daypartOf(ctx.hour);
  return slots.filter((s) => {
    if (!s.active || !s.reviewedAt) return false;
    if (s.startAt && Date.parse(s.startAt) > ctx.now) return false;
    if (s.endAt && Date.parse(s.endAt) <= ctx.now) return false;
    // A language-locked listener only gets spots in their language (or language-neutral ones).
    if (ctx.language && s.languages.length > 0 && !s.languages.includes(ctx.language)) return false;
    if (s.dayparts.length > 0 && !s.dayparts.includes(part)) return false;
    if (s.ctaUrl && !s.ctaUrl.startsWith("https://") && !s.ctaUrl.startsWith("/")) return false;
    return true;
  });
}

/** True when a break may be scheduled at all for this listener. */
export function capsAllow(ctx: AdContext, slot: AdSlot): boolean {
  if (!ctx.enabled || ctx.paid) return false;
  if (ctx.lastBreakAgeMs !== null && ctx.lastBreakAgeMs < AD_CAPS.minGapMs) return false;
  if (ctx.adSecondsLast10Min + spotSeconds(slot) > AD_CAPS.maxSecondsPer10Min) return false;
  if (ctx.adsToday >= AD_CAPS.maxPerDay) return false;
  if ((ctx.perCreativeToday[slot.id] ?? 0) >= AD_CAPS.maxPerCreativePerDay) return false;
  return true;
}

/** How many of the upcoming tracks must play before a break is allowed. */
export function tracksBeforeBreak(ctx: Pick<AdContext, "played" | "sinceBreak">): number {
  return Math.max(AD_CAPS.firstBreakAfterTracks - ctx.played, AD_CAPS.tracksBetweenBreaks - ctx.sinceBreak, 0);
}

const hits = (tags: string[], list: string[]) => tags.some((t) => list.includes(t.toLowerCase()));

/**
 * Index in `tracks` (tag lists of the upcoming tracks) at which the ad may be inserted, i.e. the number of tracks that
 * play before it. Starts at the earliest cap-allowed position and slides later past neighbours that forbid it.
 * Null when the slice is too short: the next refill will carry larger counters and try again.
 */
export function placeAd(slot: Pick<AdSlot, "excludedTags">, tracks: { tags: string[] }[], ctx: Pick<AdContext, "played" | "sinceBreak">): number | null {
  const blocked = [...NEVER_NEXT_TO, ...slot.excludedTags.map((t) => t.toLowerCase())];
  for (let p = tracksBeforeBreak(ctx); p < tracks.length; p++) {
    const before = tracks[p - 1]?.tags ?? [];
    const after = tracks[p]?.tags ?? [];
    if (hits(before, blocked) || hits(after, blocked) || hits(before, NEVER_AFTER)) continue;
    return p;
  }
  return null;
}

/** Weighted pick; `rand` is injectable for tests. */
export function weightedPick<T extends { weight: number }>(items: T[], rand: () => number = Math.random): T | null {
  const total = items.reduce((n, i) => n + Math.max(i.weight, 0), 0);
  if (items.length === 0 || total <= 0) return null;
  let r = rand() * total;
  for (const i of items) {
    r -= Math.max(i.weight, 0);
    if (r < 0) return i;
  }
  return items[items.length - 1]!;
}

export interface AdPlacement { slot: AdSlot; index: number }

/** The one break (if any) to put into this slice of the queue. */
export function pickAd(slots: AdSlot[], tracks: { tags: string[] }[], ctx: AdContext, rand: () => number = Math.random): AdPlacement | null {
  if (!ctx.enabled || ctx.paid) return null;
  const candidates = eligibleSlots(slots, ctx).filter((s) => capsAllow(ctx, s));
  // Try slots in weighted order until one fits next to its neighbours.
  const pool = [...candidates];
  while (pool.length > 0) {
    const slot = weightedPick(pool, rand);
    if (!slot) return null;
    const index = placeAd(slot, tracks, ctx);
    if (index !== null) return { slot, index };
    pool.splice(pool.indexOf(slot), 1);
  }
  return null;
}

/** Label shown on the card: house spots say so; sponsors are named. */
export function adLabel(slot: Pick<AdSlot, "kind" | "sponsorName">): string {
  return slot.kind === "sponsor" ? `Sponsored${slot.sponsorName ? ` by ${slot.sponsorName}` : ""}` : "From neo-fm";
}

export interface AdItem {
  id: string;
  type: "ad";
  title: string;
  language: string;
  tags: string[];
  durationSeconds: number;
  /** Signed audio URL, or empty for a card-only spot. */
  url: string;
  ad: { slotId: string; label: string; headline: string; ctaLabel: string | null; ctaUrl: string | null; aiMade: boolean };
}

export function adItem(slot: AdSlot, url: string, nonce: string): AdItem {
  return {
    id: `ad:${slot.id}:${nonce}`,
    type: "ad",
    title: slot.headline,
    language: slot.languages[0] ?? "",
    tags: [],
    durationSeconds: spotSeconds(slot),
    url,
    ad: { slotId: slot.id, label: adLabel(slot), headline: slot.headline, ctaLabel: slot.ctaLabel, ctaUrl: slot.ctaUrl, aiMade: slot.aiMade },
  };
}

/** DB row (snake_case) to AdSlot. */
export function rowToSlot(r: Record<string, unknown>): AdSlot {
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: String(r.id),
    kind: r.kind === "sponsor" ? "sponsor" : "house",
    sponsorName: str(r.sponsor_name),
    headline: String(r.headline ?? ""),
    ctaLabel: str(r.cta_label),
    ctaUrl: str(r.cta_url),
    audioPath: str(r.audio_path),
    durationSeconds: typeof r.duration_seconds === "number" ? r.duration_seconds : null,
    languages: arr(r.languages),
    dayparts: arr(r.dayparts),
    excludedTags: arr(r.excluded_tags),
    aiMade: r.ai_made === true,
    weight: typeof r.weight === "number" ? r.weight : 1,
    startAt: str(r.start_at),
    endAt: str(r.end_at),
    active: r.active === true,
    reviewedAt: str(r.reviewed_at),
  };
}
