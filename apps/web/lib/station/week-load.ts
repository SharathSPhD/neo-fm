import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildWeek, weekRange, type Week, type WeekSignal, type WeekTrack } from "./week";

/** A listener plays tens of tracks a day; this bounds the read for anyone far outside that. */
const MAX_SIGNALS = 3000;
const CHUNK = 100;

interface SignalRow { track_id: string; kind: string; created_at: string; position_ms: number | null }
interface TrackRow { id: string; title: string | null; language: string; genre: string | null; mood: string[] | null; duration_seconds: number | null }

/**
 * `db` is the service-role client: station_signals and pool_tracks have no listener grants, so the caller must have
 * authenticated the listener and passes only their own id. A missing table or failed read throws, so the route can say so.
 */
export async function loadWeek(db: SupabaseClient, userId: string, now: number = Date.now()): Promise<Week> {
  const { start } = weekRange(now);
  const { data: sigs, error } = await db
    .from("station_signals")
    .select("track_id, kind, created_at, position_ms")
    .eq("user_id", userId)
    .gte("created_at", start)
    .order("created_at", { ascending: false })
    .limit(MAX_SIGNALS);
  if (error) throw new Error(`week_signals_failed: ${error.message}`);

  const signals: WeekSignal[] = ((sigs ?? []) as SignalRow[]).map((r) => ({ trackId: r.track_id, kind: r.kind, createdAt: r.created_at, positionMs: r.position_ms }));
  const ids = [...new Set(signals.map((s) => s.trackId))];
  const tracks: Record<string, WeekTrack> = {};
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error: te } = await db.from("pool_tracks").select("id, title, language, genre, mood, duration_seconds").in("id", ids.slice(i, i + CHUNK));
    if (te) throw new Error(`week_tracks_failed: ${te.message}`);
    for (const r of (data ?? []) as TrackRow[]) {
      tracks[r.id] = { title: r.title, language: r.language, genre: r.genre, mood: r.mood ?? [], durationSeconds: r.duration_seconds };
    }
  }
  return buildWeek(signals, tracks, now);
}
