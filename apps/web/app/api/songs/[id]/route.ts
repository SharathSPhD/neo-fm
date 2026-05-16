/**
 * GET /api/songs/{id}
 *
 * Returns one song belonging to the authenticated user, including the
 * Song Document and (if a track exists) a short-lived signed URL to the
 * rendered audio. RLS on `jobs` + `tracks` + the storage policy enforces
 * ownership: a user that does not own the job cannot read the row in the
 * first place, so the signed URL is never minted for them.
 */
import { NextResponse, type NextRequest } from "next/server";

import { SongIdSchema } from "../../../../lib/api/song-schemas";
import { requireUser } from "../../../../lib/supabase/auth";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

type SongWithRelations = {
  id: string;
  status: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  song_document_id: string;
  song_documents: {
    id: string;
    language: string;
    style_family: string;
    document_json: unknown;
    title: string | null;
    created_at: string;
  } | null;
  tracks:
    | {
        id: string;
        url: string;
        duration_seconds: number | null;
        format: string;
        bytes: number | null;
        expires_at: string | null;
        created_at: string;
      }[]
    | null;
};

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authed = await requireUser();
  if (authed instanceof NextResponse) return authed;
  const { supabase } = authed;

  const parsed = SongIdSchema.safeParse(params.id);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("jobs")
    .select(
      `
      id,
      status,
      error,
      created_at,
      finished_at,
      song_document_id,
      song_documents (
        id, language, style_family, document_json, title, created_at
      ),
      tracks (
        id, url, duration_seconds, format, bytes, expires_at, created_at
      )
    `,
    )
    .eq("id", parsed.data)
    .order("created_at", { referencedTable: "tracks", ascending: false })
    .maybeSingle<SongWithRelations>();

  if (error) {
    return NextResponse.json(
      { error: "get_failed", details: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Pick the most recent track for this job. The query orders nested
  // tracks by created_at desc; we also re-sort defensively here so that
  // future schema or PostgREST changes can't silently regress.
  let signedTrack: {
    url: string;
    duration_seconds: number | null;
    format: string;
    bytes: number | null;
  } | undefined;
  const tracks = (data.tracks ?? []).slice().sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  );
  const track = tracks[0];
  if (track) {
    const objectPath = track.url.replace(/^tracks\//, "");
    const { data: signed, error: signErr } = await supabase.storage
      .from("tracks")
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed) {
      return NextResponse.json(
        { error: "signing_failed", details: signErr?.message },
        { status: 500 },
      );
    }
    signedTrack = {
      url: signed.signedUrl,
      duration_seconds: track.duration_seconds,
      format: track.format,
      bytes: track.bytes,
    };
  }

  return NextResponse.json({
    id: data.id,
    status: data.status,
    error: data.error,
    created_at: data.created_at,
    finished_at: data.finished_at,
    song_document: data.song_documents,
    track: signedTrack,
  });
}
