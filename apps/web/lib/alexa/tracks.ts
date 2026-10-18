/**
 * TrackSource for the Alexa skill, backed by the same pool, ranking, clock wheel and steering as /api/station/queue.
 * Alexa listeners are anonymous here (account linking is a later step), so ranking runs on rules only and no signals
 * are read or written.
 */
import { resolveClock } from "@/lib/station/clock";
import { loadPool, loadPoolTrack, type StationTrack } from "@/lib/station/pool";
import { programQueue } from "@/lib/station/program";
import { rankTracks } from "@/lib/station/rank";
import { steerQueue } from "@/lib/station/steer";
import { createServiceRoleClient } from "@/lib/supabase/server";

import type { AlexaTrack, NextTrackQuery, TrackSource } from "./skill";

/** Alexa keeps the URL for as long as the stream is paused or queued, so give it more room than the web player's hour. */
const URL_TTL_SECONDS = 6 * 60 * 60;

async function toAlexaTrack(t: StationTrack): Promise<AlexaTrack | null> {
  const { data } = await createServiceRoleClient().storage.from("tracks").createSignedUrl(t.audioPath.replace(/^tracks\//, ""), URL_TTL_SECONDS);
  return data?.signedUrl ? { id: t.id, title: t.title, language: t.language, url: data.signedUrl } : null;
}

export const poolTrackSource: TrackSource = {
  async next(q: NextTrackQuery) {
    const pool = await loadPool();
    if (pool.length === 0) return null;
    const clock = resolveClock(null, null);
    const slate = rankTracks(pool, [], { language: q.language, limit: 40 });
    const recent = new Set(q.recentIds);
    const byId = new Map(pool.map((t) => [t.id, t]));
    const programmed = programQueue(slate, {
      ...clock,
      familiar: new Set(),
      limit: 10,
      rotation: { history: q.recentIds.flatMap((id) => byId.get(id) ?? []), recentIds: recent, languageLocked: !!q.language },
    });
    const steered = q.energy || q.moreLike ? steerQueue(programmed, pool, { energy: q.energy, moreLike: q.moreLike }, q.moreLike) : programmed;
    // Never replay the last few tracks of this stream; if the pool is too small to avoid it, fall back to the head.
    const pick = steered.find((t) => !recent.has(t.id)) ?? steered[0];
    const full = pick ? byId.get(pick.id) : undefined;
    return full ? toAlexaTrack(full) : null;
  },
  async byId(id: string) {
    const t = await loadPoolTrack(id);
    return t ? toAlexaTrack(t) : null;
  },
};
