/**
 * Reads the admitted station pool (pool_tracks, migration 0092, owned by the pool thread; service-role only, so callers
 * must authenticate the listener first). Only status = 'admitted'
 * rows are ever returned. A missing table or any read failure yields an empty pool, never an error, so the station
 * degrades to "nothing to play yet" if the migration is not applied.
 */
import { createServiceRoleClient } from "@/lib/supabase/server";

import type { PoolTrack } from "./rank";

export interface PoolRow {
  id: string;
  title: string | null;
  audio_path: string;
  duration_seconds: number | null;
  language: string;
  genre: string | null;
  raga: string | null;
  mood: string[] | null;
  theme: string[] | null;
  tempo_band: string | null;
}

export type StationTrack = PoolTrack & {
  title: string;
  audioPath: string;
  durationSeconds: number | null;
};

const LANGUAGE_NAMES: Record<string, string> = {
  hi: "Hindi", ta: "Tamil", te: "Telugu", kn: "Kannada", bn: "Bengali", en: "English", sa: "Sanskrit", hinglish: "Hinglish",
};

/** Most pool rows have no title yet; "Kannada folk" reads better than "Untitled" on the player. */
function displayTitle(r: PoolRow): string {
  const t = r.title?.trim();
  if (t) return t;
  const lang = LANGUAGE_NAMES[r.language] ?? r.language;
  const genre = r.genre?.replace(/-/g, " ");
  return genre ? `${lang} ${genre}` : lang;
}

export function rowToTrack(r: PoolRow): StationTrack {
  const tags = [...(r.mood ?? []), ...(r.theme ?? []), r.genre, r.raga, r.tempo_band]
    .filter((t): t is string => !!t)
    .map((t) => t.toLowerCase());
  return {
    id: r.id,
    language: r.language,
    tags: [...new Set(tags)],
    family: `${r.language}:${r.genre ?? "any"}`,
    title: displayTitle(r),
    audioPath: r.audio_path,
    durationSeconds: r.duration_seconds,
  };
}

export async function loadPool(): Promise<StationTrack[]> {
  try {
    const { data, error } = await (
      createServiceRoleClient().from as unknown as (t: string) => {
        select: (c: string) => { eq: (k: string, v: string) => Promise<{ data: PoolRow[] | null; error: unknown }> };
      }
    )("pool_tracks")
      .select("id,title,audio_path,duration_seconds,language,genre,raga,mood,theme,tempo_band")
      .eq("status", "admitted");
    if (error || !data) return [];
    return data.map(rowToTrack);
  } catch {
    return [];
  }
}
