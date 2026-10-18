/**
 * GET /api/station/queue?lang=hi&tags=birthday,upbeat&limit=10 -- the next tracks for this listener.
 * Ranking v0 (lib/station/rank.ts): requested language/tags plus this listener's own signals from the last 30 days.
 * Each track carries a short-lived signed URL. Empty list when the pool or signal table is unavailable.
 */
import { NextResponse, type NextRequest } from "next/server";

import { loadPool } from "@/lib/station/pool";
import { rankTracks } from "@/lib/station/rank";
import { rowsToSignals, type SignalRow } from "@/lib/station/signals";
import { requireUser } from "@/lib/supabase/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SIGNAL_WINDOW_MS = 30 * 86_400_000;
const URL_TTL_SECONDS = 60 * 60;

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

  const ranked = rankTracks(pool, rowsToSignals(rows), { language: lang, wantTags, limit });
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
