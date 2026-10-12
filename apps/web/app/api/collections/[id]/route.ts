/**
 * PATCH  /api/collections/[id]  { title?, description?, visibility? }
 * DELETE /api/collections/[id]
 * Owner only; text is moderated before it can become public.
 */
import { NextResponse, type NextRequest } from "next/server";

import { collectionsDb, COLLECTION_COLUMNS, type CollectionRow } from "../../../../lib/collections/load";
import { moderationText, PatchCollectionSchema } from "../../../../lib/collections/schema";
import { screenRequest } from "../../../../lib/safety";
import { requireUser } from "../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = PatchCollectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const patch = parsed.data;

  const text = moderationText({ title: patch.title, description: patch.description });
  if (text) {
    const verdict = await screenRequest(text, "brief");
    if (!verdict.allowed) {
      return NextResponse.json(
        { error: "content_blocked", reason: verdict.reason },
        { status: 422 },
      );
    }
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description || null;
  if (patch.visibility !== undefined) update.visibility = patch.visibility;

  const { data, error } = await collectionsDb()
    .from("collections")
    .update(update)
    .eq("id", params.id)
    .eq("user_id", authed.user.id)
    .select(COLLECTION_COLUMNS)
    .maybeSingle<CollectionRow>();
  if (error) return NextResponse.json({ error: "internal" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ collection: data });
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const { data, error } = await collectionsDb()
    .from("collections")
    .delete()
    .eq("id", params.id)
    .eq("user_id", authed.user.id)
    .select("id");
  if (error) return NextResponse.json({ error: "internal" }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
