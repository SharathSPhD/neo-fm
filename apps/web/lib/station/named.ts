/**
 * Named stations ("Subah", "Raat", "Diwali Radio"): presets over the same pool and ranking, no new data. A station
 * leans the queue toward its tags, can pin the clock wheel to a daypart, and can force an occasion theme. They are
 * linkable (`/station?s=subah`), which gives campaigns and shares a stable address.
 */
import { daypartOf } from "./program";
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
  /** Tracks the tagger rated at this energy band are left out (tagged tracks only; untagged ones are judged by tags). */
  avoidEnergy?: "low" | "mid" | "high";
}

export const NAMED_STATIONS: readonly NamedStation[] = [
  { slug: "subah", name: "Subah", tagline: "Morning ragas, bhajans and gentle starts.", tags: ["devotional", "bhakti", "calm", "classical", "light-classical"], pinHour: 6, avoidEnergy: "high" },
  { slug: "sham", name: "Sham", tagline: "Evening songs for the way home.", tags: ["nostalgic", "romantic", "ballad", "folk"], pinHour: 17 },
  { slug: "raat", name: "Raat", tagline: "Slow, soft songs for the late hours.", tags: ["calm", "romantic", "slow", "melancholic", "ballad"], pinHour: 23, avoidEnergy: "high" },
  { slug: "diwali", name: "Diwali Radio", tagline: "Festive songs for the festival of lights.", tags: ["diwali", "festive", "celebratory", "joyful"], themes: ["diwali", "festive", "celebratory"] },
];

/** Below this many matching tracks a station would feel like a loop, so it only leans instead of filtering. */
export const MIN_STATION_TRACKS = 8;

export function findStation(slug: string | null | undefined): NamedStation | null {
  return NAMED_STATIONS.find((s) => s.slug === slug) ?? null;
}

/**
 * Tagger output (pool_tracks.daypart / energy, migration 0096) decides when a track has it: a station pinned to an hour
 * takes the tracks tagged for that part of the day, and skips the energy band it avoids. Tracks the tagger has not reached
 * keep the tag match.
 */
export function stationMatches(t: PoolTrack, station: NamedStation): boolean {
  if (station.avoidEnergy && t.energy === station.avoidEnergy) return false;
  if (station.pinHour !== undefined && t.daypart && t.daypart.length > 0) return t.daypart.includes(daypartOf(station.pinHour));
  return t.tags.some((g) => station.tags.includes(g));
}

/** The tracks a station draws from: its matches when there are enough, otherwise the whole pool (the tags still lean). */
export function stationPool<T extends PoolTrack>(pool: T[], station: NamedStation): T[] {
  const own = pool.filter((t) => stationMatches(t, station));
  return own.length >= MIN_STATION_TRACKS ? own : pool;
}
