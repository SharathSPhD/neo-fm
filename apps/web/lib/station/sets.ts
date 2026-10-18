/**
 * Station "sets" (council item R4). Vocal tracks run about a minute and instrumentals two and a half, so a plain
 * shuffle alternates and nothing ever settles. A set groups 2 or 3 same-language vocal tracks into one block that
 * crossfades, and instrumentals sit between blocks, held to a share of the clock time by daypart. Off unless
 * STATION_SETS=1; the queue route and the player behave exactly as before without it.
 */
import type { PoolTrack } from "./rank";
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
 * A block takes the best remaining vocal, then up to two more of its language; with several languages left, the next
 * block changes language so the "no more than three of one language in a row" rule still holds. After each block an
 * instrumental is added when the share stays under the daypart cap and is still under its target. At dawn, none goes
 * next to a devotional block.
 */
export function arrangeSets(vocals: PoolTrack[], instrumentals: PoolTrack[], opts: { hour: number; limit: number; setSize?: number }): Arranged {
  const part = daypartOf(opts.hour);
  const policy = instrumentalPolicy(part);
  const size = Math.max(2, opts.setSize ?? SET_SIZE);
  const v = vocals.filter((t) => !isInstrumental(t));
  const inst = [...instrumentals.filter(isInstrumental), ...vocals.filter(isInstrumental)];
  const tracks: PoolTrack[] = [];
  const sets = new Map<string, SetInfo>();
  let total = 0;
  let instrTime = 0;
  let lastLanguage: string | null = null;
  let blockNo = 0;

  while (tracks.length < opts.limit && v.length > 0) {
    const languages = new Set(v.map((t) => t.language));
    const other: PoolTrack | undefined = languages.size > 1 && lastLanguage !== null ? v.find((t) => t.language !== lastLanguage) : undefined;
    const lead: PoolTrack = other ?? v[0]!;
    const block = [lead, ...v.filter((t) => t !== lead && t.language === lead.language).slice(0, size - 1)];
    for (const t of block) v.splice(v.indexOf(t), 1);
    const id = `set${blockNo++}`;
    block.forEach((t, i) => {
      tracks.push(t);
      total += seconds(t);
      if (block.length > 1) sets.set(t.id, { id, index: i, size: block.length });
    });
    lastLanguage = lead.language;

    const next = inst.findIndex((t) => !(part === "dawn" && (isDevotional(t) || block.some(isDevotional) || isDevotional(v[0]))));
    if (next >= 0 && tracks.length < opts.limit) {
      const d = seconds(inst[next]!);
      const share = instrTime / total;
      if (share < policy.target && (instrTime + d) / (total + d) <= policy.cap) {
        const [t] = inst.splice(next, 1);
        tracks.push(t!);
        total += d;
        instrTime += d;
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
