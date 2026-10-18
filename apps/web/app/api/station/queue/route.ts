/**
 * GET /api/station/queue?lang=hi&tags=birthday,upbeat&limit=10 -- the next tracks for this listener.
 * Ranking (lib/station/rank.ts) scores the pool from the requested language/tags and this listener's signals from the last 30 days;
 * the clock wheel (lib/station/program.ts) then orders the queue for the listener-local hour (`tz` IANA name, else `hour=0-23`, else India time).
 * `station=<slug>` (lib/station/named.ts) narrows to a named station: its tags lean the ranking, and it can pin the daypart
 * or force an occasion theme.
 * Optional steering (lib/station/steer.ts): `energy=up|down`, `like=<track id>` ("more like this") and `exclude=<track id>`
 * re-order the programmed list so the listener's tap shows in the very next tracks.
 * Each track carries a templated `host` line (lib/station/host.ts: daypart greeting, edge city if any, AI-made label; no model call)
 * and a short-lived signed URL. Empty list when the pool or signal table is unavailable.
 */
import { NextResponse, type NextRequest } from "next/server";

import { cityFromHeader, hostLine } from "@/lib/station/host";
import { findStation, stationPool } from "@/lib/station/named";
import { loadPool } from "@/lib/station/pool";
import { resolveClock } from "@/lib/station/clock";
import { familiarIds, programQueue } from "@/lib/station/program";
import { rankTracks } from "@/lib/station/rank";
import { TRACK_SEPARATION_MS } from "@/lib/station/rotation";
import { parseSteer, steerQueue } from "@/lib/station/steer";
import { rowsToSignals, type SignalRow } from "@/lib/station/signals";
import { requireUser } from "@/lib/supabase/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SIGNAL_WINDOW_MS = 30 * 86_400_000;
const URL_TTL_SECONDS = 60 * 60;

/** The listener's own signals from the last 30 days; empty when the table is missing or the read fails. */
async function loadSignalRows(admin: ReturnType<typeof createServiceRoleClient>, userId: string): Promise<SignalRow[]> {
  try {
    const since = new Date(Date.now() - SIGNAL_WINDOW_MS).toISOString();
    const { data } = await (
      admin.from as unknown as (t: string) => {
        select: (c: string) => {
          eq: (k: string, v: string) => { gte: (k: string, v: string) => Promise<{ data: SignalRow[] | null }> };
        };
      }
    )("station_signals")
      .select("track_id,kind,created_at")
      .eq("user_id", userId)
      .gte("created_at", since);
    return data ?? [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  // Open to signed-out visitors: the pool is shared, and anonymous listeners get the rules-only queue (no signals are
  // read or stored for them). The edge rate limit (lib/rate-limit.ts, station:queue) bounds it per IP.
  const authed = await requireUser();
  const user = authed instanceof NextResponse ? null : authed.user;
  const admin = createServiceRoleClient();

  const sp = req.nextUrl.searchParams;
  const lang = sp.get("lang");
  const station = findStation(sp.get("station"));
  const wantTags = (sp.get("tags") ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8);
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 10, 1), user ? 25 : 10);

  const fullPool = await loadPool();
  const pool = station ? stationPool(fullPool, station) : fullPool;
  if (pool.length === 0) return NextResponse.json({ tracks: [] });

  const signals = user ? rowsToSignals(await loadSignalRows(admin, user.id)) : [];
  // Rank a wide slate, then let the clock wheel pick and order what actually plays at this hour.
  const slate = rankTracks(pool, signals, { language: lang, wantTags: station ? [...new Set([...wantTags, ...station.tags])] : wantTags, limit: Math.max(limit * 4, 40) });
  const clock = resolveClock(sp.get("tz"), sp.get("hour"));
  const city = cityFromHeader(req.headers.get("x-vercel-ip-city"));
  const { exclude, ...steer } = parseSteer(sp);
  const steered = Boolean(steer.energy || steer.moreLike);
  // What this listener heard lately, oldest first, so rotation carries across refills and sessions.
  const plays = signals.filter((x) => x.kind === "play").sort((a, b) => b.ageMs - a.ageMs);
  const byId = new Map(pool.map((t) => [t.id, t]));
  const rotation = {
    history: plays.slice(-10).flatMap((x) => byId.get(x.trackId) ?? []),
    recentIds: new Set(plays.filter((x) => x.ageMs < TRACK_SEPARATION_MS).map((x) => x.trackId)),
    languageLocked: !!lang,
  };
  // A steer re-orders a wider programmed list, so the nudge can pull in tracks the wheel would have placed later.
  const programmed = programQueue(slate, { ...clock, ...(station?.pinHour !== undefined ? { hour: station.pinHour } : {}), themes: station?.themes, familiar: familiarIds(signals), limit: steered ? Math.min(limit * 3, 60) : limit, rotation });
  const ranked = steered || exclude ? steerQueue(programmed, pool, steer, exclude).slice(0, limit) : programmed;
  const tracks = (
    await Promise.all(
      ranked.map(async (r) => {
        const t = byId.get(r.id)!;
        const { data } = await admin.storage.from("tracks").createSignedUrl(t.audioPath.replace(/^tracks\//, ""), URL_TTL_SECONDS);
        if (!data?.signedUrl) return null;
        const host = hostLine({ hour: clock.hour, language: t.language, city, seed: t.id });
        return { id: t.id, title: t.title, language: t.language, tags: t.tags, durationSeconds: t.durationSeconds, host, url: data.signedUrl };
      }),
    )
  ).filter((t) => t !== null);
  return NextResponse.json({ tracks });
}
