/**
 * POST /api/songs/[id]/recover  (Sprint C bug-b)
 *
 * Re-enqueues a stuck job. "Stuck" means either:
 *
 *   - status='completed' but no `tracks` row -- the user-visible
 *     "Audio URL pending..." orphan, or
 *   - status='failed' -- the user wants to try again.
 *
 * Delegates to the SECURITY DEFINER RPC `public.recover_song_job`
 * (migration 0016). The RPC verifies ownership against auth.uid() and
 * atomically resets the row + pushes a fresh pgmq message. We translate
 * the RPC's `raise exception` strings into HTTP status codes.
 *
 * 200  -> { job_id, attempt_id, status: "queued" }  (success)
 * 401  -> caller is unauthenticated
 * 404  -> job not owned by caller (RPC: 'job_not_found')
 * 409  -> job is not in a recoverable state (RPC: 'not_recoverable: ...')
 * 500  -> anything else
 */
import { NextResponse, type NextRequest } from "next/server";

import { SongIdSchema } from "../../../../../lib/api/song-schemas";
import { requireUser } from "../../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  const parsed = SongIdSchema.safeParse(params.id);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc(
    // RPC name added by migration 0016; not yet in generated types.
    "recover_song_job" as never,
    { p_job_id: parsed.data } as never,
  );

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("unauthenticated")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (msg.includes("job_not_found")) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (msg.includes("not_recoverable")) {
      return NextResponse.json(
        { error: "not_recoverable", details: msg },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "recover_failed", details: msg },
      { status: 500 },
    );
  }

  // recover_song_job returns SETOF (...); supabase-js gives us an array.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return NextResponse.json(
      { error: "recover_failed", details: "empty_rpc_result" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      job_id: (row as { job_id: string }).job_id,
      attempt_id: (row as { attempt_id: string }).attempt_id,
      status: (row as { status: string }).status,
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
