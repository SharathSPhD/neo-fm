/**
 * POST /api/songs/[id]/rename  body: { title }
 *
 * Updates `song_documents.title` for the song attached to this job.
 * Uses the SECURITY INVOKER `rename_song` RPC so RLS still applies.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/supabase/auth";
import { SONG_TITLE_MAX_CHARS, SongTitleSchema } from "@neo-fm/song-doc";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const BodySchema = z.object({ title: SongTitleSchema });

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        details: parsed.error.flatten(),
        max_length: SONG_TITLE_MAX_CHARS,
      },
      { status: 400 },
    );
  }
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  const { data, error } = await supabase.rpc("rename_song", {
    p_job_id: params.id,
    p_title: parsed.data.title,
  } as never);
  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (error.code === "22023") {
      return NextResponse.json({ error: "empty_title" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "rename_failed", details: error.message },
      { status: 500 },
    );
  }
  const row = Array.isArray(data) ? data[0] : null;
  return NextResponse.json({
    id: params.id,
    title: row?.title ?? parsed.data.title,
  });
}
