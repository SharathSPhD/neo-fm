/**
 * Flow rules for what plays next to what. Ranking and the clock wheel pick *who* plays; this layer keeps neighbours
 * from clashing: a bhajan must not run into a dhol dance track, and energy should move one step at a time.
 * Everything works from the pool tags (genre, mood, theme, tagger energy), so untagged tracks are "other", mid energy,
 * and never clash with anything.
 */
import type { PoolTrack } from "./rank";

export type Feel = "devotional" | "dance" | "other";
export type EnergyLevel = 0 | 1 | 2;

const DEVOTIONAL_TAGS: ReadonlySet<string> = new Set(["devotional", "bhakti", "bhajan", "prayer", "kirtan", "abhang", "keerthana", "bhakti-geet", "prabhatiya"]);
/** Genres made to be danced to. Garba and dandiya carry a bhakti theme, but they are dance floors first. */
const DANCE_GENRES: ReadonlySet<string> = new Set(["bhangra", "garba", "dandiya", "folk-boliyan", "wedding-jaggo", "lavani", "dhol", "kuthu", "dappankuthu", "hiphop", "trap", "dance", "dance-pop"]);
const UP_TAGS: ReadonlySet<string> = new Set(["energetic", "fast", "playful", "celebratory"]);
const DOWN_TAGS: ReadonlySet<string> = new Set(["calm", "slow", "lullaby", "ambient"]);

export function feelOf(t: PoolTrack): Feel {
  const genre = t.tags.find((g) => DANCE_GENRES.has(g));
  if (genre) return "dance";
  // A bhakti-themed track the tagger rates high energy (a dhol procession, a wedding number) is not for a quiet bhajan neighbour.
  if (t.energy === "high" && (t.tags.includes("energetic") || t.tags.some((g) => DEVOTIONAL_TAGS.has(g)))) return "dance";
  if (t.tags.some((g) => DEVOTIONAL_TAGS.has(g))) return "devotional";
  return "other";
}

export function energyOf(t: PoolTrack): EnergyLevel {
  if (t.energy === "low") return 0;
  if (t.energy === "mid") return 1;
  if (t.energy === "high") return 2;
  const score = t.tags.filter((g) => UP_TAGS.has(g)).length - t.tags.filter((g) => DOWN_TAGS.has(g)).length;
  return score >= 2 ? 2 : score <= -2 ? 0 : 1;
}

/** Cost at or above this is a clash the sequencer avoids whenever any other choice exists. */
export const CLASH = 4;
const FEEL_CLASH = 10;
const ENERGY_JUMP_2 = 4;
const ENERGY_STEP = 1;
/** A melancholic track straight after a party track (or back) reads as a mood swing. */
const MOOD_CONTRAST = 2;

const BRIGHT: ReadonlySet<string> = new Set(["energetic", "celebratory", "festive", "joyful", "playful"]);
const isBright = (t: PoolTrack) => t.tags.some((g) => BRIGHT.has(g));
const isSad = (t: PoolTrack) => t.tags.includes("melancholic");

/** How jarring `b` is straight after `a`: 0 is seamless, `CLASH` or more is a clash. */
export function transitionCost(a: PoolTrack | undefined | null, b: PoolTrack): number {
  if (!a) return 0;
  const fa = feelOf(a);
  const fb = feelOf(b);
  let cost = 0;
  if ((fa === "devotional" && fb === "dance") || (fa === "dance" && fb === "devotional")) cost += FEEL_CLASH;
  const gap = Math.abs(energyOf(a) - energyOf(b));
  cost += gap >= 2 ? ENERGY_JUMP_2 : gap * ENERGY_STEP;
  if ((isSad(a) && isBright(b) && energyOf(b) === 2) || (isSad(b) && isBright(a) && energyOf(a) === 2)) cost += MOOD_CONTRAST;
  return cost;
}

export const clashes = (a: PoolTrack | undefined | null, b: PoolTrack) => transitionCost(a, b) >= CLASH;
