/**
 * Station "sets" (council item R4). Vocal tracks run about a minute and instrumentals two and a half, so a plain
 * shuffle alternates and nothing ever settles. A set groups 2 or 3 same-language vocal tracks into one block that
 * crossfades, and instrumentals sit between blocks, held to a share of the clock time by daypart. Off unless
 * STATION_SETS=1; the queue route and the player behave exactly as before without it.
 */
import type { PoolTrack } from "./rank";
import { CLASH, feelOf, transitionCost } from "./flow";
import { daypartOf, type Daypart } from "./program";

export const SET_SIZE = 3;
/** Overlap the player aims for between two tracks of one set (it falls back to a hard cut where it cannot fade). */
export const CROSSFADE_MS = 2500;
const VOCAL_SECONDS = 60;
const INSTRUMENTAL_SECONDS = 150;

export function setsEnabled(): boolean {
  return process.env.STATION_SETS === "1";
}

export interface InstrumentalPolicy {
  /** Highest share of clock time instrumentals may take. */
  cap: number;
  /** A new instrumental is only added while the share is below this. */
  target: number;
}

/** About a quarter of the hour; a little more at midday and at night, when listeners want background. */
export function instrumentalPolicy(part: Daypart): InstrumentalPolicy {
  return part === "midday" || part === "night" ? { cap: 0.3, target: 0.25 } : { cap: 0.25, target: 0.2 };
}

const DEVOTIONAL = ["devotional", "bhakti", "bhajan", "prayer", "kirtan"];
const isDevotional = (t: PoolTrack | undefined) => !!t && t.tags.some((g) => DEVOTIONAL.includes(g));
const isInstrumental = (t: PoolTrack) => t.kind === "instrumental";
const seconds = (t: PoolTrack) => t.durationSeconds ?? (isInstrumental(t) ? INSTRUMENTAL_SECONDS : VOCAL_SECONDS);

export interface SetInfo { id: string; index: number; size: number }
export interface Arranged { tracks: PoolTrack[]; sets: Map<string, SetInfo> }

/**
 * Orders `vocals` and `instrumentals` (each best-first, already programmed for the hour) into sets.
 * A block takes the best remaining vocal that does not clash with the previous track (lib/station/flow.ts: devotional never
 * next to dance, energy never low to high in one step), then up to two more of its language and feel; with several languages
 * left, the next block changes language so the "no more than three of one language in a row" rule still holds. After each block an
 * instrumental is added when the share stays under the daypart cap and is still under its target. At dawn, none goes
 * next to a devotional block.
 * `recent` is what this listener just played, oldest first. It seeds the share, because a queue is only ~10 tracks of about
 * 30 seconds and one fetch alone can never hold an instrumental (150 s) under the cap: without it a listener never gets one.
 */
export function arrangeSets(vocals: PoolTrack[], instrumentals: PoolTrack[], opts: { hour: number; limit: number; setSize?: number; recent?: PoolTrack[] }): Arranged {
  const part = daypartOf(opts.hour);
  const policy = instrumentalPolicy(part);
  const size = Math.max(2, opts.setSize ?? SET_SIZE);
  const v = vocals.filter((t) => !isInstrumental(t));
  const inst = [...instrumentals.filter(isInstrumental), ...vocals.filter(isInstrumental)];
  const tracks: PoolTrack[] = [];
  const sets = new Map<string, SetInfo>();
  let total = 0;
  let instrTime = 0;
  for (const t of opts.recent ?? []) {
    total += seconds(t);
    if (isInstrumental(t)) instrTime += seconds(t);
  }
  let lastLanguage: string | null = null;
  let blockNo = 0;
  // Whatever this listener heard last is the neighbour of the first track, so a refill does not restart the mood.
  let tail: PoolTrack | undefined = opts.recent?.[opts.recent.length - 1];

  /** First candidate that does not clash with `prev`; failing that, the smoothest one. Rank order breaks ties. */
  const smoothest = (cands: PoolTrack[], prev: PoolTrack | undefined): PoolTrack | undefined => {
    const ok = cands.find((t) => transitionCost(prev, t) < CLASH);
    if (ok) return ok;
    return cands.reduce<PoolTrack | undefined>((best, t) => (!best || transitionCost(prev, t) < transitionCost(prev, best) ? t : best), undefined);
  };

  while (tracks.length < opts.limit && v.length > 0) {
    const languages = new Set(v.map((t) => t.language));
    const others = languages.size > 1 && lastLanguage !== null ? v.filter((t) => t.language !== lastLanguage) : [];
    const lead: PoolTrack = smoothest(others.length > 0 ? others : v, tail)!;
    // Mates share the lead's language and feel; a devotional block never takes a dance track, and each step stays smooth.
    const mates: PoolTrack[] = [];
    let last = lead;
    while (mates.length < size - 1) {
      const same = v.filter((t) => t !== lead && !mates.includes(t) && t.language === lead.language);
      const pick = same.find((t) => feelOf(t) === feelOf(lead) && transitionCost(last, t) < CLASH) ?? same.find((t) => transitionCost(last, t) < CLASH);
      if (!pick) break;
      mates.push(pick);
      last = pick;
    }
    const block = [lead, ...mates];
    for (const t of block) v.splice(v.indexOf(t), 1);
    const id = `set${blockNo++}`;
    block.forEach((t, i) => {
      tracks.push(t);
      total += seconds(t);
      if (block.length > 1) sets.set(t.id, { id, index: i, size: block.length });
    });
    lastLanguage = lead.language;
    tail = last;

    // An instrumental must fit the block it follows and leave some vocal it can lead into without a clash.
    const next = inst.findIndex((t) => !(part === "dawn" && (isDevotional(t) || block.some(isDevotional) || isDevotional(v[0]))) && transitionCost(tail, t) < CLASH && (v.length === 0 || v.some((x) => transitionCost(t, x) < CLASH)));
    if (next >= 0 && tracks.length < opts.limit) {
      const d = seconds(inst[next]!);
      const share = instrTime / total;
      if (share < policy.target && (instrTime + d) / (total + d) <= policy.cap) {
        const [t] = inst.splice(next, 1);
        tracks.push(t!);
        total += d;
        instrTime += d;
        tail = t;
      }
    }
  }
  return { tracks: tracks.slice(0, opts.limit), sets };
}

/** Per-track crossfade hints for the player: fade in after a set mate, fade out before one. */
export function crossfadeFor(info: SetInfo | undefined): { fadeInMs: number; fadeOutMs: number } | null {
  if (!info) return null;
  return { fadeInMs: info.index > 0 ? CROSSFADE_MS : 0, fadeOutMs: info.index < info.size - 1 ? CROSSFADE_MS : 0 };
}
