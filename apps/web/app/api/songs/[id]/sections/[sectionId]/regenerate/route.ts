/**
 * POST /api/songs/[id]/sections/[sectionId]/regenerate
 *
 * Sprint 2 M5: section-level regeneration. Body is empty; the section
 * identity and parent song come from the URL. The endpoint delegates
 * to the `create_section_regen_job` RPC (migration 0012), which:
 *
 *   - asserts the parent job is owned by the caller
 *   - asserts the parent is `completed`
 *   - asserts `sectionId` exists in the parent's SongDocument
 *   - enforces the monthly quota (regen counts as a new job)
 *   - inserts a child `jobs` row with `parent_job_id` and `section_id`
 *   - enqueues a queue message with `is_section_regen: true` so the
 *     Phase 5 worker code path will eventually mix the new section
 *     back into the parent track.
 *
 * Until Phase 5 (vocal-synth + mixer) lands, the worker just runs the
 * regen as a short standalone generation. The detail page surfaces it
 * as "regen queued" so the user knows the request was accepted.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { SongIdSchema } from "../../../../../../../lib/api/song-schemas";
import { requireUser } from "../../../../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const SectionIdSchema = z.string().min(1).max(64);

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string; sectionId: string } },
) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  const idCheck = SongIdSchema.safeParse(params.id);
  const sectionCheck = SectionIdSchema.safeParse(
    decodeURIComponent(params.sectionId),
  );
  if (!idCheck.success) {
    return NextResponse.json(
      { error: "invalid_request", details: idCheck.error.flatten() },
      { status: 400 },
    );
  }
  if (!sectionCheck.success) {
    return NextResponse.json(
      { error: "invalid_request", details: sectionCheck.error.flatten() },
      { status: 400 },
    );
  }

  const trace_id = randomUUID();
  const attempt_id = randomUUID();

  const { data, error } = await supabase.rpc("create_section_regen_job", {
    p_parent_job_id: idCheck.data,
    p_section_id: sectionCheck.data,
    p_attempt_id: attempt_id,
    p_trace_id: trace_id,
  } as never);

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("parent_job_not_found")) {
      // 404, not 403, so we don't leak existence of other users' songs.
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (msg.includes("parent_job_not_completed")) {
      return NextResponse.json(
        { error: "parent_not_completed" },
        { status: 409 },
      );
    }
    if (msg.includes("section_not_in_document")) {
      return NextResponse.json(
        { error: "section_not_in_document" },
        { status: 400 },
      );
    }
    if (msg.includes("concurrent_cap_exceeded")) {
      return NextResponse.json(
        { error: "concurrent_cap_exceeded", reason: "in_flight_jobs" },
        { status: 429 },
      );
    }
    if (msg.includes("quota_exceeded")) {
      return NextResponse.json(
        { error: "quota_exceeded", reason: "rows_per_month" },
        { status: 429 },
      );
    }
    if (msg.includes("unauthenticated")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "regen_failed", details: msg },
      { status: 500 },
    );
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    return NextResponse.json({ error: "regen_failed" }, { status: 500 });
  }

  return NextResponse.json(
    {
      job_id: row.job_id,
      parent_job_id: row.parent_job_id,
      section_id: row.section_id,
      status: row.status,
    },
    { status: 202 },
  );
}
