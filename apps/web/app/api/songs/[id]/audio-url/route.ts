/**
 * GET /api/songs/[id]/audio-url
 *
 * Mints a fresh signed URL for the latest track of this song. Used by
 * the detail page (M4) and library audio player when the previously
 * minted URL has expired and the `<audio>` element fires `error`.
 *
 * See ADR 0012 (signed-URL playback). Two-tier signed-URL pattern:
 *   - Tier 1: page render path embeds an initial 1h-TTL URL.
 *   - Tier 2: when that URL expires, the client refetches *this*
 *     endpoint to get a new one without a page reload.
 *
 * Returns 404 (not 403) for songs the user doesn't own. RLS on `jobs`
 * already makes the row invisible; we surface the same shape so we
 * don't leak existence of other users' songs.
 */
import { NextResponse, type NextRequest } from "next/server";

import { SongIdSchema } from "../../../../../lib/api/song-schemas";
import { requireUser } from "../../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour, same as the page render path.

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  const parsed = SongIdSchema.safeParse(params.id);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  // We only need the track row; RLS on `jobs` -> `tracks` already
  // enforces ownership. Single shallow query, no nested embeddings.
  const { data: jobRow, error: jobErr } = await supabase
    .from("jobs")
    .select(
      `
      id,
      status,
      tracks ( id, url, duration_seconds, format, bytes, created_at )
    `,
    )
    .eq("id", parsed.data)
    .maybeSingle<{
      id: string;
      status: string;
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

  // Job exists but no track yet (still queued/processing/failed). Use a
  // dedicated status so the client can decide whether to keep polling
  // (queued/processing) or give up (failed).
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
    {
      // ADR 0012: never cache the signed URL. A stale cached URL is the
      // exact failure mode we're trying to recover from.
      headers: { "cache-control": "no-store" },
    },
  );
}
