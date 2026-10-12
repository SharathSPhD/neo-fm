/**
 * POST /api/collections/[id]/items  { jobId }
 * Adds a song to the caller's collection. Allowed songs: the caller's own, or
 * anyone's published (public/unlisted) song. Idempotent.
 */
import { NextResponse, type NextRequest } from "next/server";

import { collectionsDb } from "../../../../../lib/collections/load";
import {
  AddItemSchema,
  canAddSong,
  MAX_ITEMS_PER_COLLECTION,
} from "../../../../../lib/collections/schema";
import { requireUser } from "../../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { user } = authed;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = AddItemSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { jobId } = parsed.data;

  const sb = collectionsDb();
  const { data: col } = await sb
    .from("collections")
    .select("id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!col) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: song } = await sb
    .from("jobs")
    .select("user_id, published_visibility")
    .eq("id", jobId)
    .maybeSingle<{ user_id: string; published_visibility: string | null }>();
  // Same answer for "missing" and "someone else's private song": don't reveal existence.
  if (!song || !canAddSong(song, user.id)) {
    return NextResponse.json({ error: "song_not_found" }, { status: 404 });
  }

  const { data: items } = await sb
    .from("collection_items")
    .select("job_id, position")
    .eq("collection_id", params.id)
    .returns<{ job_id: string; position: number }[]>();
  const existing = items ?? [];
  if (existing.some((i) => i.job_id === jobId)) {
    return NextResponse.json({ ok: true, already: true });
  }
  if (existing.length >= MAX_ITEMS_PER_COLLECTION) {
    return NextResponse.json({ error: "limit_reached" }, { status: 409 });
  }
  const position = existing.reduce((m, i) => Math.max(m, i.position), -1) + 1;
  const { error } = await sb
    .from("collection_items")
    .insert({ collection_id: params.id, job_id: jobId, position });
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  await sb.from("collections").update({ updated_at: new Date().toISOString() }).eq("id", params.id);
  return NextResponse.json({ ok: true }, { status: 201 });
}
