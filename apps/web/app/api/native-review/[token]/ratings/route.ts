/** POST /api/native-review/[token]/ratings -- upsert one reviewer's rating for one song (token link is the credential). */
import { NextResponse, type NextRequest } from "next/server";

import { serviceClient } from "../../../../../lib/agent/adapters";
import { RatingSchema } from "../../../../../lib/native-review/kit";
import { resolveToken } from "../../../../../lib/native-review/load";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const reviewer = await resolveToken(params.token);
  if (!reviewer) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = RatingSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_rating" }, { status: 400 });
  const { item_id, comment, ...scores } = parsed.data;
  const db = serviceClient();
  // The item must belong to this reviewer's language, so a token cannot rate other languages' songs.
  const { data: item } = await db
    .from("review_items")
    .select("id, jobs!inner(id)")
    .eq("id", item_id)
    .eq("language", reviewer.language)
    .in("jobs.published_visibility", ["public", "unlisted"])
    .maybeSingle();
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { error } = await db.from("review_ratings").upsert(
    { token_id: reviewer.id, item_id, ...scores, comment: comment || null, updated_at: new Date().toISOString() },
    { onConflict: "token_id,item_id" },
  );
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
