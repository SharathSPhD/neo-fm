/**
 * GET /api/station/queue?lang=hi&tags=birthday,upbeat&limit=10 -- the next tracks for this listener.
 * Ranking (lib/station/rank.ts) scores the pool from the requested language/tags and this listener's signals from the last 30 days;
 * the clock wheel (lib/station/program.ts) then orders the queue for the listener-local hour (`hour=0-23`, India time if absent).
 * Optional steering (lib/station/steer.ts): `energy=up|down`, `like=<track id>` ("more like this") and `exclude=<track id>`
 * re-order the programmed list so the listener's tap shows in the very next tracks.
 * Each track carries a short-lived signed URL. Empty list when the pool or signal table is unavailable.
 */
import { NextResponse, type NextRequest } from "next/server";

import { loadPool } from "@/lib/station/pool";
import { familiarIds, programQueue } from "@/lib/station/program";
import { rankTracks } from "@/lib/station/rank";
import { parseSteer, steerQueue } from "@/lib/station/steer";
import { rowsToSignals, type SignalRow } from "@/lib/station/signals";
import { requireUser } from "@/lib/supabase/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SIGNAL_WINDOW_MS = 30 * 86_400_000;
const URL_TTL_SECONDS = 60 * 60;
const IST_OFFSET_MS = 5.5 * 3_600_000;

/** Listener-local clock: the client sends its hour; without it we assume India time, the launch market. */
function localClock(hourParam: string | null, now = Date.now()) {
  const ist = new Date(now + IST_OFFSET_MS);
  const h = hourParam === null || hourParam === "" ? NaN : Number(hourParam);
  const hour = Number.isInteger(h) && h >= 0 && h <= 23 ? h : ist.getUTCHours();
  return { hour, month: ist.getUTCMonth() + 1, day: ist.getUTCDate() };
}

export async function GET(req: NextRequest) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { user } = authed;
  const admin = createServiceRoleClient();

  const sp = req.nextUrl.searchParams;
  const lang = sp.get("lang");
  const wantTags = (sp.get("tags") ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8);
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 10, 1), 25);

  const pool = await loadPool();
  if (pool.length === 0) return NextResponse.json({ tracks: [] });

  let rows: SignalRow[] = [];
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
      .eq("user_id", user.id)
      .gte("created_at", since);
    rows = data ?? [];
  } catch { /* no signals yet: rules-only ranking */ }

  const signals = rowsToSignals(rows);
  // Rank a wide slate, then let the clock wheel pick and order what actually plays at this hour.
  const slate = rankTracks(pool, signals, { language: lang, wantTags, limit: Math.max(limit * 4, 40) });
  const { exclude, ...steer } = parseSteer(sp);
  const steered = Boolean(steer.energy || steer.moreLike);
  // A steer re-orders a wider programmed list, so the nudge can pull in tracks the wheel would have placed later.
  const programmed = programQueue(slate, { ...localClock(sp.get("hour")), familiar: familiarIds(signals), limit: steered ? Math.min(limit * 3, 60) : limit });
  const ranked = steered || exclude ? steerQueue(programmed, pool, steer, exclude).slice(0, limit) : programmed;
  const byId = new Map(pool.map((t) => [t.id, t]));
  const tracks = (
    await Promise.all(
      ranked.map(async (r) => {
        const t = byId.get(r.id)!;
        const { data } = await admin.storage.from("tracks").createSignedUrl(t.audioPath.replace(/^tracks\//, ""), URL_TTL_SECONDS);
        if (!data?.signedUrl) return null;
        return { id: t.id, title: t.title, language: t.language, tags: t.tags, durationSeconds: t.durationSeconds, url: data.signedUrl };
      }),
    )
  ).filter((t) => t !== null);
  return NextResponse.json({ tracks });
}
