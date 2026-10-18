/**
 * One-tap steering for the station queue: "more like this" and "calmer / livelier". Pure re-ordering of an already
 * programmed list, so with no steer the queue is exactly what the clock wheel produced.
 */
import type { PoolTrack } from "./rank";

export type Energy = "up" | "down";

export interface Steer {
  energy?: Energy | null;
  /** Track the listener asked for more of; ignored when it is not in the pool. */
  moreLike?: string | null;
}

/** Tags the pool tagger uses for energy (scripts/pool-seed.mjs moods plus tempo bands); unknown tags score 0. */
export const ENERGY_UP_TAGS: ReadonlySet<string> = new Set(["energetic", "fast", "joyful", "playful", "celebratory", "festive", "pop"]);
export const ENERGY_DOWN_TAGS: ReadonlySet<string> = new Set(["calm", "slow", "romantic", "melancholic", "ballad", "light-classical"]);

const SIMILARITY_WEIGHT = 4;
const SAME_LANGUAGE_BONUS = 1;
const ENERGY_WEIGHT = 1.5;
const ENERGY_TAG_CAP = 3;

function similarity(a: PoolTrack, b: PoolTrack): number {
  const sa = new Set(a.tags);
  const shared = b.tags.filter((t) => sa.has(t)).length;
  const union = new Set([...a.tags, ...b.tags]).size;
  return (union ? shared / union : 0) * SIMILARITY_WEIGHT + (a.language === b.language ? SAME_LANGUAGE_BONUS : 0);
}

/** Tagger energy band mapped onto the tag scale (+/- ENERGY_TAG_CAP); mid is neutral. */
const BAND_SCORE = { low: -ENERGY_TAG_CAP, mid: 0, high: ENERGY_TAG_CAP } as const;

function energyScore(t: PoolTrack, energy: Energy): number {
  if (t.energy) return ENERGY_WEIGHT * (energy === "up" ? BAND_SCORE[t.energy] : -BAND_SCORE[t.energy]);
  const up = Math.min(ENERGY_TAG_CAP, t.tags.filter((x) => ENERGY_UP_TAGS.has(x)).length);
  const down = Math.min(ENERGY_TAG_CAP, t.tags.filter((x) => ENERGY_DOWN_TAGS.has(x)).length);
  return ENERGY_WEIGHT * (energy === "up" ? up - down : down - up);
}

/** Stable re-sort: steer score first, the incoming order breaks ties. `exclude` drops the track now playing. */
export function steerQueue<T extends PoolTrack>(queue: T[], pool: PoolTrack[], steer: Steer, exclude?: string | null): T[] {
  const base = exclude ? queue.filter((t) => t.id !== exclude) : queue;
  const seed = steer.moreLike ? pool.find((t) => t.id === steer.moreLike) : undefined;
  if (!seed && !steer.energy) return base;
  const score = (t: T) =>
    (seed && t.id !== seed.id ? similarity(seed, t) : 0) + (steer.energy ? energyScore(t, steer.energy) : 0);
  return base
    .map((t, i) => ({ t, i, s: score(t) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.t);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Untrusted query params to a Steer; anything malformed is dropped rather than rejected. */
export function parseSteer(params: URLSearchParams): Steer & { exclude: string | null } {
  const energy = params.get("energy");
  const like = params.get("like");
  const exclude = params.get("exclude");
  return {
    energy: energy === "up" || energy === "down" ? energy : null,
    moreLike: like && UUID_RE.test(like) ? like : null,
    exclude: exclude && UUID_RE.test(exclude) ? exclude : null,
  };
}
