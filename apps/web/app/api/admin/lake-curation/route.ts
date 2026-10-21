/**
 * GET /api/admin/lake-curation[?lang=kn,hi] -- ranks the admitted pool by diction, judge score, listener signals (last 30
 * days) and open reports, and flags weak tracks for replacement in the next fill (lib/pool/curation.ts). Read-only,
 * spends nothing, Bearer ADMIN_SECRET like the other admin routes. A missing signals or reports table reads as no signal.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../lib/agent/adapters";
import { checkAdminBearer } from "../../../../lib/agent/auth";
import { curateLake, NO_SIGNALS, type CurationTrack, type TrackSignals } from "../../../../lib/pool/curation";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const SIGNAL_DAYS = 30;
const ROW_CAP = 20_000;

export async function GET(req: NextRequest) {
  const auth = checkAdminBearer(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const langs = (req.nextUrl.searchParams.get("lang") ?? "kn,hi").split(",").map((l) => l.trim().toLowerCase()).filter(Boolean).slice(0, 6);
  const db = serviceClient();
  const pool = await db
    .from("pool_tracks")
    .select("id,title,language,genre,energy,diction_u,judge_overall,duration_seconds")
    .eq("status", "admitted")
    .in("language", langs)
    .limit(ROW_CAP);
  if (pool.error) return NextResponse.json({ error: "query_failed", detail: pool.error.message }, { status: 502 });
  const tracks = (pool.data ?? []) as unknown as CurationTrack[];

  const signals = new Map<string, TrackSignals>();
  const since = new Date(Date.now() - SIGNAL_DAYS * 86_400_000).toISOString();
  const sig = await db.from("station_signals").select("track_id,kind").gte("created_at", since).limit(ROW_CAP);
  for (const r of (sig.error ? [] : sig.data ?? []) as { track_id: string; kind: string }[]) {
    const s = { ...(signals.get(r.track_id) ?? NO_SIGNALS) };
    if (r.kind === "play") s.plays++;
    else if (r.kind === "skip") s.skips++;
    else if (r.kind === "finish") s.finishes++;
    else if (r.kind === "like") s.likes++;
    else if (r.kind === "replay") s.replays++;
    else if (r.kind === "share") s.shares++;
    signals.set(r.track_id, s);
  }

  const reports = new Map<string, number>();
  const rep = await db.from("song_reports").select("pool_track_id").eq("status", "open").not("pool_track_id", "is", null).limit(ROW_CAP);
  for (const r of (rep.error ? [] : rep.data ?? []) as { pool_track_id: string }[]) reports.set(r.pool_track_id, (reports.get(r.pool_track_id) ?? 0) + 1);

  return NextResponse.json({
    ...curateLake(tracks, signals, reports),
    notes: { signals: sig.error ? "unavailable" : `${SIGNAL_DAYS}d`, reports: rep.error ? "unavailable (migration 0110 not applied)" : "open", truncated: tracks.length >= ROW_CAP || (sig.data?.length ?? 0) >= ROW_CAP },
  });
}
