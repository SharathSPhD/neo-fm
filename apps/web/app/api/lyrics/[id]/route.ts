/**
 * GET /api/lyrics/[id]
 *
 * Returns the full body of a single bundled lyric. The id is the same
 * `${language}/${slug}` string the listing endpoint returns. Used by the
 * library picker when the user clicks "use this lyric" on a card -- the
 * editor then drops the body into the active section's textarea.
 *
 * Auth: same as /api/lyrics (signed-in user only).
 */
import { findBundledLyric } from "@neo-fm/lyrics";
import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;

  // The id is path-segment URL-encoded by Next.js. Decode it back to the
  // canonical `${language}/${slug}` so it matches what the catalog returns.
  const id = decodeURIComponent(params.id);
  const entry = findBundledLyric(id);
  if (!entry) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      id: entry.id,
      title: entry.title,
      author: entry.author,
      language: entry.language,
      script: entry.script,
      body: entry.body,
      source_url: entry.source_url,
      source_citation: entry.source_citation,
      license_assertion: entry.license_assertion,
    },
    {
      headers: {
        "cache-control": "private, max-age=300, stale-while-revalidate=600",
      },
    },
  );
}
