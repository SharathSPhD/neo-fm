/** DELETE /api/collections/[id]/items/[jobId] -- remove a song from the caller's collection. */
import { NextResponse, type NextRequest } from "next/server";

import { collectionsDb } from "../../../../../../lib/collections/load";
import { requireUser } from "../../../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: NextRequest,
  props: { params: Promise<{ id: string; jobId: string }> },
) {
  const params = await props.params;
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  if (!UUID_RE.test(params.id) || !UUID_RE.test(params.jobId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const sb = collectionsDb();
  const { data: col } = await sb
    .from("collections")
    .select("id")
    .eq("id", params.id)
    .eq("user_id", authed.user.id)
    .maybeSingle();
  if (!col) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { error } = await sb
    .from("collection_items")
    .delete()
    .eq("collection_id", params.id)
    .eq("job_id", params.jobId);
  if (error) return NextResponse.json({ error: "internal" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
