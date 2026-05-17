/**
 * POST /api/songs/[id]/compare — RLHF pairwise vote (v1.4 Sprint 16).
 *
 * Body: `{ winner_track_id: uuid, loser_track_id: uuid, choice: "A" | "B" | "tie" }`
 *
 * Calls the `record_preference_pair` RPC (migration 0041) which:
 *   - validates both tracks belong to the named job
 *   - validates the caller owns the job
 *   - inserts a row into `preference_pairs` with the originating style/language
 *
 * "Tie" votes are recorded with `vote_source='compare-page-tie'` so the
 * reward-model trainer can either weight them down or drop them
 * entirely. We record rather than discard because zero-difference
 * signal is itself useful regularisation.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { SongIdSchema } from "../../../../../lib/api/song-schemas";
import { requireUser } from "../../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const CompareBodySchema = z.object({
  winner_track_id: z.string().uuid(),
  loser_track_id: z.string().uuid(),
  choice: z.enum(["A", "B", "tie"]),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  const idCheck = SongIdSchema.safeParse(params.id);
  if (!idCheck.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const bodyCheck = CompareBodySchema.safeParse(body);
  if (!bodyCheck.success) {
    return NextResponse.json(
      { error: "invalid_body", details: bodyCheck.error.flatten() },
      { status: 400 },
    );
  }

  if (bodyCheck.data.winner_track_id === bodyCheck.data.loser_track_id) {
    return NextResponse.json(
      { error: "tracks_must_differ" },
      { status: 422 },
    );
  }

  const voteSource =
    bodyCheck.data.choice === "tie" ? "compare-page-tie" : "compare-page";

  const { data, error } = await supabase.rpc("record_preference_pair", {
    p_job_id: idCheck.data,
    p_winner_track_id: bodyCheck.data.winner_track_id,
    p_loser_track_id: bodyCheck.data.loser_track_id,
    p_vote_source: voteSource,
  });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (code === "P0002") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (code === "22023") {
      return NextResponse.json(
        { error: "validation_failed", details: error.message },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: "rpc_failed", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    preference_pair_id: data as string,
    choice: bodyCheck.data.choice,
  });
}
