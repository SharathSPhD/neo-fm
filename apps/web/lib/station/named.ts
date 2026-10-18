/**
 * Named stations ("Subah", "Raat", "Diwali Radio"): presets over the same pool and ranking, no new data. A station
 * leans the queue toward its tags, can pin the clock wheel to a daypart, and can force an occasion theme. They are
 * linkable (`/station?s=subah`), which gives campaigns and shares a stable address.
 */
import type { PoolTrack } from "./rank";

export interface NamedStation {
  slug: string;
  name: string;
  tagline: string;
  /** Tags that define the station; any one matches. */
  tags: readonly string[];
  /** Pin the clock wheel to this hour (0-23) instead of the listener's; omit to follow the listener's clock. */
  pinHour?: number;
  /** Force these occasion themes into the wheel's occasion slot regardless of the calendar. */
  themes?: readonly string[];
}

export const NAMED_STATIONS: readonly NamedStation[] = [
  { slug: "subah", name: "Subah", tagline: "Morning ragas, bhajans and gentle starts.", tags: ["devotional", "bhakti", "calm", "classical", "light-classical"], pinHour: 6 },
  { slug: "sham", name: "Sham", tagline: "Evening songs for the way home.", tags: ["nostalgic", "romantic", "ballad", "folk"], pinHour: 17 },
  { slug: "raat", name: "Raat", tagline: "Slow, soft songs for the late hours.", tags: ["calm", "romantic", "slow", "melancholic", "ballad"], pinHour: 23 },
  { slug: "diwali", name: "Diwali Radio", tagline: "Festive songs for the festival of lights.", tags: ["diwali", "festive", "celebratory", "joyful"], themes: ["diwali", "festive", "celebratory"] },
];

/** Below this many matching tracks a station would feel like a loop, so it only leans instead of filtering. */
export const MIN_STATION_TRACKS = 8;

export function findStation(slug: string | null | undefined): NamedStation | null {
  return NAMED_STATIONS.find((s) => s.slug === slug) ?? null;
}

const matches = (t: PoolTrack, station: NamedStation) => t.tags.some((g) => station.tags.includes(g));

/** The tracks a station draws from: its matches when there are enough, otherwise the whole pool (the tags still lean). */
export function stationPool<T extends PoolTrack>(pool: T[], station: NamedStation): T[] {
  const own = pool.filter((t) => matches(t, station));
  return own.length >= MIN_STATION_TRACKS ? own : pool;
}
