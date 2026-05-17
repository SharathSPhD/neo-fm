/**
 * v1.4 Sprint 4 — Personal preset CRUD.
 *
 *   GET  /api/user-presets        list the caller's saved presets
 *   POST /api/user-presets        save the current SongDocument as a
 *                                 personal preset (title + document)
 *
 * The list endpoint reads through RLS — `user_presets_select_own`
 * narrows the row set to `auth.uid()`. Writes go through the
 * `save_user_preset` SECURITY DEFINER RPC (migration 0038) which
 * enforces title trim/length, derives the index columns from the
 * document, and rejects callers who already have 20 presets stored
 * (sqlstate 23505 → HTTP 409).
 */
import { SongDocumentSchema } from "@neo-fm/song-doc";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

const SaveBodySchema = z.object({
  title: z.string().trim().min(1).max(120),
  song_document: SongDocumentSchema,
});

export async function GET() {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  const { data, error } = await supabase
    .from("user_presets")
    .select(
      "id,title,style_family,language,target_duration_seconds,song_document,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json(
      { error: "list_failed", details: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ presets: data ?? [] });
}

export async function POST(req: Request) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  // The body must parse as JSON; an empty/malformed body is a 400.
  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const result = SaveBodySchema.safeParse(parsedBody);
  if (!result.success) {
    return NextResponse.json(
      {
        error: "validation_failed",
        details: result.error.flatten(),
      },
      { status: 422 },
    );
  }
  const { title, song_document } = result.data;

  const { data, error } = await supabase.rpc("save_user_preset", {
    p_title: title,
    p_song_document: song_document as unknown as never,
  });

  if (error) {
    // 23505 = too_many_presets (20-per-user cap from migration 0038).
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "too_many_presets", limit: 20 },
        { status: 409 },
      );
    }
    if (error.code === "22023") {
      return NextResponse.json(
        { error: "validation_failed", details: error.message },
        { status: 422 },
      );
    }
    if (error.code === "42501") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "save_failed", details: error.message },
      { status: 500 },
    );
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.id) {
    return NextResponse.json(
      { error: "save_failed", details: "RPC returned no row" },
      { status: 500 },
    );
  }
  return NextResponse.json(
    { id: row.id, created_at: row.created_at, title },
    { status: 201 },
  );
}
