/**
 * POST /api/report { public_id | track_id, reason, details? } -- anyone (signed in or not) can report a public song
 * (public_id) or a station pool track (track_id, migration 0110; before it is applied the answer is 503 report_unavailable).
 * Writes to public.song_reports (service role; table has no public insert policy). IP rate limiting is applied by
 * middleware for /api/*. Reports are reviewed via the admin queue (GET /api/admin/reports, POST /api/admin/reports/resolve) and the grievance mailbox.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "@/lib/agent/adapters";
import { isTrackId } from "@/lib/station/share";
import { getLogger } from "@/lib/obs/log";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const REASONS = ["impersonation", "hateful_or_harassing", "sexual_or_minor", "copyright", "other"] as const;

export async function POST(req: NextRequest) {
  let body: { public_id?: unknown; track_id?: unknown; reason?: unknown; details?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const publicId = typeof body.public_id === "string" ? body.public_id.slice(0, 64) : "";
  const reason = typeof body.reason === "string" && (REASONS as readonly string[]).includes(body.reason) ? body.reason : null;
  const details = typeof body.details === "string" ? body.details.trim().slice(0, 1000) : "";
  const trackId = typeof body.track_id === "string" && isTrackId(body.track_id) ? body.track_id : "";
  if ((!publicId && !trackId) || !reason) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const db = serviceClient();
  if (trackId) return reportPoolTrack(req, db, trackId, reason, details);
  const { data: job } = await db.from("jobs").select("id").eq("public_id", publicId).in("published_visibility", ["public", "unlisted"]).maybeSingle();
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let reporter: string | null = null;
  try { const { data } = await createServerClient().auth.getUser(); reporter = data?.user?.id ?? null; } catch { /* anonymous report */ }

  const jobId = (job as { id: string }).id;
  if (reporter) {
    // A signed-in user re-reporting a song that is still under review adds nothing to the queue.
    const { data: dup } = await db.from("song_reports").select("id").eq("job_id", jobId).eq("reporter_id", reporter).eq("status", "open").limit(1);
    if ((dup ?? []).length) return NextResponse.json({ ok: true });
  }
  const { error } = await db.from("song_reports").insert({ job_id: jobId, reporter_id: reporter, reason: details ? `${reason}: ${details}` : reason, category: reason, details: details || null });
  if (error) {
    getLogger("/api/report", req).error("report_insert_failed", { detail: error.message });
    return NextResponse.json({ error: "report_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

async function reportPoolTrack(req: NextRequest, db: ReturnType<typeof serviceClient>, trackId: string, reason: string, details: string) {
  const { data: track } = await db.from("pool_tracks").select("id").eq("id", trackId).eq("status", "admitted").maybeSingle();
  if (!track) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let reporter: string | null = null;
  try { const { data } = await createServerClient().auth.getUser(); reporter = data?.user?.id ?? null; } catch { /* anonymous report */ }

  const { error } = await db.from("song_reports").insert({ pool_track_id: trackId, reporter_id: reporter, reason: details ? `${reason}: ${details}` : reason, category: reason, details: details || null });
  if (error) {
    // 42703 undefined column / 23502 null job_id: migration 0110 is not applied yet.
    const code = (error as { code?: string }).code;
    if (code === "42703" || code === "23502" || /pool_track_id|job_id/.test(error.message)) {
      return NextResponse.json({ error: "report_unavailable" }, { status: 503 });
    }
    getLogger("/api/report", req).error("report_insert_failed", { detail: error.message });
    return NextResponse.json({ error: "report_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
