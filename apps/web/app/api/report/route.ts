/**
 * POST /api/report { public_id, reason, details? } -- anyone (signed in or not) can report a public song.
 * Writes to public.song_reports (service role; table has no public insert policy). IP rate limiting is applied by
 * middleware for /api/*. Reports are reviewed via the admin queue (GET /api/admin/reports) and the grievance mailbox.
 */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "@/lib/agent/adapters";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const REASONS = ["impersonation", "hateful_or_harassing", "sexual_or_minor", "copyright", "other"] as const;

export async function POST(req: NextRequest) {
  let body: { public_id?: unknown; reason?: unknown; details?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const publicId = typeof body.public_id === "string" ? body.public_id.slice(0, 64) : "";
  const reason = typeof body.reason === "string" && (REASONS as readonly string[]).includes(body.reason) ? body.reason : null;
  const details = typeof body.details === "string" ? body.details.trim().slice(0, 1000) : "";
  if (!publicId || !reason) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const db = serviceClient();
  const { data: job } = await db.from("jobs").select("id").eq("public_id", publicId).in("published_visibility", ["public", "unlisted"]).maybeSingle();
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let reporter: string | null = null;
  try { const { data } = await createServerClient().auth.getUser(); reporter = data?.user?.id ?? null; } catch { /* anonymous report */ }

  const { error } = await db.from("song_reports").insert({ job_id: (job as { id: string }).id, reporter_id: reporter, reason: details ? `${reason}: ${details}` : reason });
  if (error) return NextResponse.json({ error: "report_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
