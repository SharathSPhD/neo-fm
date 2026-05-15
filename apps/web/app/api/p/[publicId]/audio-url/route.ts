/**
 * GET /api/p/[publicId]/audio-url
 *
 * Unauthenticated. Mints a fresh 1h signed URL for the latest track of a
 * **published** song. Mirrors `/api/songs/[id]/audio-url` (ADR 0012) but
 * the visibility gate is the `published_visibility` column instead of the
 * caller's session, and we use the service-role client to bypass RLS for
 * the storage signing.
 *
 * The service-role bypass is safe here because:
 *   1. We resolve the song by `public_id` (10-char Crockford base32 slug,
 *      ~50 bits entropy) and require `published_visibility in
 *      ('public','unlisted')`.
 *   2. We mint only against the canonical `tracks/<job_id>/...` path
 *      derived from the row we just read.
 *   3. The returned URL has a 1h TTL and is never cached (`no-store`).
 *
 * Returns 404 for unknown / unpublished / private songs.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createServiceRoleClient } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const PublicIdSchema = z
  .string()
  .regex(/^[0-9abcdefghjkmnpqrstvwxyz]{10}$/);

export async function GET(
  _request: NextRequest,
  { params }: { params: { publicId: string } },
) {
  const idCheck = PublicIdSchema.safeParse(params.publicId);
  if (!idCheck.success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const supabase = createServiceRoleClient();
  const { data: jobRow, error: jobErr } = await supabase
    .from("jobs")
    .select(
      `
      id,
      status,
      public_id,
      published_visibility,
      tracks ( id, url, duration_seconds, format, bytes, created_at )
    `,
    )
    .eq("public_id", idCheck.data)
    .in("published_visibility", ["public", "unlisted"])
    .maybeSingle<{
      id: string;
      status: string;
      public_id: string;
      published_visibility: "public" | "unlisted" | "private";
      tracks:
        | {
            id: string;
            url: string;
            duration_seconds: number | null;
            format: string;
            bytes: number | null;
            created_at: string;
          }[]
        | null;
    }>();

  if (jobErr) {
    return NextResponse.json(
      { error: "lookup_failed", details: jobErr.message },
      { status: 500 },
    );
  }
  if (!jobRow) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const tracks = jobRow.tracks ?? [];
  if (tracks.length === 0 || jobRow.status !== "completed") {
    return NextResponse.json(
      { error: "no_track", status: jobRow.status },
      { status: 404 },
    );
  }

  const latest = tracks
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]!;
  const objectPath = latest.url.replace(/^tracks\//, "");
  const { data: signed, error: signErr } = await supabase.storage
    .from("tracks")
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed) {
    return NextResponse.json(
      { error: "signing_failed", details: signErr?.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      url: signed.signedUrl,
      expires_in_seconds: SIGNED_URL_TTL_SECONDS,
      format: latest.format,
      duration_seconds: latest.duration_seconds,
      bytes: latest.bytes,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
