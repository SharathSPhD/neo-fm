/**
 * GET  /api/collections[?job=<id>]  -> caller's collections (with `has_song` when job given)
 * POST /api/collections             -> create { title, description?, visibility? }
 *
 * Writes go through the service client (migration 0081 grants users read-only
 * access) after auth and moderation, because title/description are public on
 * shared collections.
 */
import { NextResponse, type NextRequest } from "next/server";

import { collectionsDb, COLLECTION_COLUMNS, type CollectionRow } from "../../../lib/collections/load";
import {
  CreateCollectionSchema,
  MAX_COLLECTIONS_PER_USER,
  mintPublicId,
  moderationText,
} from "../../../lib/collections/schema";
import { screenRequest } from "../../../lib/safety";
import { requireUser } from "../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const sb = collectionsDb();
  const { data, error } = await sb
    .from("collections")
    .select(`${COLLECTION_COLUMNS}, collection_items ( job_id )`)
    .eq("user_id", authed.user.id)
    .order("updated_at", { ascending: false })
    .limit(MAX_COLLECTIONS_PER_USER)
    .returns<(CollectionRow & { collection_items: { job_id: string }[] })[]>();
  if (error) return NextResponse.json({ error: "internal" }, { status: 500 });
  const job = request.nextUrl.searchParams.get("job");
  const jobId = job && UUID_RE.test(job) ? job : null;
  return NextResponse.json({
    collections: (data ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      visibility: c.visibility,
      public_id: c.public_id,
      count: c.collection_items.length,
      has_song: jobId ? c.collection_items.some((i) => i.job_id === jobId) : undefined,
    })),
  });
}

export async function POST(request: NextRequest) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { user } = authed;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = CreateCollectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { title, description, visibility } = parsed.data;

  const verdict = await screenRequest(moderationText({ title, description }), "brief");
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "content_blocked", reason: verdict.reason },
      { status: 422 },
    );
  }

  const sb = collectionsDb();
  const { count } = await sb
    .from("collections")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) >= MAX_COLLECTIONS_PER_USER) {
    return NextResponse.json({ error: "limit_reached" }, { status: 409 });
  }

  // public_id is unique; a collision is astronomically unlikely but retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await sb
      .from("collections")
      .insert({
        user_id: user.id,
        title,
        description: description || null,
        visibility,
        public_id: mintPublicId(),
      })
      .select(COLLECTION_COLUMNS)
      .single<CollectionRow>();
    if (!error) return NextResponse.json({ collection: data }, { status: 201 });
    if (error.code !== "23505") break;
  }
  return NextResponse.json({ error: "internal" }, { status: 500 });
}
