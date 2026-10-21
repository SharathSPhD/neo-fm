import type { TasteBrief } from "../taste/brief";

/**
 * Cold-start nudge from a listener's saved taste profile (lib/taste, the same normaliseTaste signal STATION_TASTE reads) to the
 * arms. Form-heavy traditions (ghazal, carnatic, bhavageete, folk...) and a formal register lean on corpus exemplars; a purely
 * Western profile leans on the live arm. The nudge is small, per arm, and fades as the listener's own rewards accumulate, so
 * behaviour always overrules what they said about themselves.
 */
export const TASTE_PRIOR_CAP = 0.05;
/** Own observations (a + b - 2) after which the prior has halved. */
export const TASTE_FADE_N = 10;

const FORM_HEAVY = new Set(["carnatic", "hindustani", "ghazal", "sufi", "devotional", "bhavageete", "rabindrasangeet", "folk"]);
const WESTERN = new Set(["pop", "rock", "indie folk", "hip-hop", "r&b", "country", "electronic", "jazz", "lo-fi", "ballad", "gospel"]);

export function tasteArmPrior(taste: TasteBrief | null | undefined): Record<string, number> {
  if (!taste) return {};
  const genres = taste.genres ?? [];
  const form = genres.filter((g) => FORM_HEAVY.has(g)).length + (taste.register === "formal" ? 1 : 0);
  const western = genres.length > 0 && genres.every((g) => WESTERN.has(g));
  const refs = Math.min(TASTE_PRIOR_CAP, 0.025 * form);
  const live = western ? 0.02 : 0;
  const out: Record<string, number> = {};
  if (refs > 0) { out.refs = refs; out.refs_opus = refs; }
  if (live > 0) out.live = live;
  return out;
}

/** The prior an arm gets for this listener, halved every TASTE_FADE_N of their own settled observations of that arm. */
export function fadedPrior(prior: Record<string, number> | undefined, armId: string, ownObservations: number): number {
  const p = prior?.[armId] ?? 0;
  return Math.max(-TASTE_PRIOR_CAP, Math.min(TASTE_PRIOR_CAP, p)) / (1 + Math.max(0, ownObservations) / TASTE_FADE_N);
}
