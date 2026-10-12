/**
 * POST /api/songs/{id}/feedback  { kind, value?, payload? }
 * Records a user signal (play %, replay, like, regenerate, ...) in feedback_events. RLS pins user_id to the caller,
 * and the caller must be able to see the job. Used by the personalization and self-improvement loops; no content is stored.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { SongIdSchema } from "../../../../../lib/api/song-schemas";
import { requireUser } from "../../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["play_pct", "replay", "like", "dislike", "share", "download", "regenerate", "lyric_pick", "line_edit", "report", "abandon"]),
  value: z.number().min(0).max(1000).optional(),
  payload: z.record(z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const id = SongIdSchema.safeParse(params.id);
  if (!id.success) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { supabase, user } = authed;
  // RLS on jobs proves the caller can see this song.
  const { data: job } = await supabase.from("jobs").select("id").eq("id", id.data).maybeSingle();
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { error } = await supabase.from("feedback_events" as never).insert({
    user_id: user.id, job_id: id.data, kind: parsed.data.kind, value: parsed.data.value ?? null, payload: parsed.data.payload ?? null,
  } as never);
  if (error) return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
