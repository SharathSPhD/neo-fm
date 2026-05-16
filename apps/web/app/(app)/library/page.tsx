import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";

import { SongList } from "./song-list";

export const dynamic = "force-dynamic";

type RawJobRow = {
  id: string;
  status: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  song_documents:
    | {
        id: string;
        language: string;
        style_family: string;
      }
    | null;
  tracks:
    | {
        url: string;
        duration_seconds: number | null;
        format: string;
        created_at: string;
      }[]
    | null;
};

export default async function LibraryPage() {
  const supabase = createServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    redirect("/sign-in?next=/library");
  }

  const { data, error } = await supabase
    .from("jobs")
    .select(
      `
      id, status, error, created_at, finished_at,
      song_documents ( id, language, style_family ),
      tracks ( url, duration_seconds, format, created_at )
    `,
    )
    .order("created_at", { ascending: false })
    .order("created_at", { referencedTable: "tracks", ascending: false })
    .limit(50)
    .returns<RawJobRow[]>();

  // Worker writes `tracks.url` as `tracks/<job_id>/<attempt_id>.wav` (full
  // bucket-qualified path). The Storage SDK's createSignedUrl wants the
  // bucket-relative path, so strip the leading `tracks/`. RLS policy
  // `tracks_storage_select_via_job` lets the signed-URL call succeed for
  // any job this user owns.
  const TRACK_BUCKET_PREFIX = "tracks/";
  const tracksApi = supabase.storage.from("tracks");
  const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1h is the user's "library session"

  const songs = await Promise.all(
    (data ?? []).map(async (row) => {
      const latestTrack = (row.tracks ?? [])
        .slice()
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      let audioUrl: string | null = null;
      if (latestTrack?.url && row.status === "completed") {
        const path = latestTrack.url.startsWith(TRACK_BUCKET_PREFIX)
          ? latestTrack.url.slice(TRACK_BUCKET_PREFIX.length)
          : latestTrack.url;
        const { data: signed } = await tracksApi.createSignedUrl(
          path,
          SIGNED_URL_TTL_SECONDS,
        );
        audioUrl = signed?.signedUrl ?? null;
      }
      return {
        id: row.id,
        status: row.status,
        error: row.error,
        created_at: row.created_at,
        language: row.song_documents?.language ?? null,
        style_family: row.song_documents?.style_family ?? null,
        audio_url: audioUrl,
        duration_seconds: latestTrack?.duration_seconds ?? null,
      };
    }),
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-medium tracking-tight">Library</h1>
          <p className="text-sm text-foreground/60">
            Your latest songs. Free tier caps at 3 per month.
          </p>
        </div>
      </header>

      {error ? (
        <p className="rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          Couldn&apos;t load songs: {error.message}
        </p>
      ) : songs.length === 0 ? (
        <EmptyState
          title="No songs yet"
          body="Pick a style preset, type a verse, hit Generate. Your first song will land here in about a minute."
          cta={{ href: "/songs/new", label: "Create your first song" }}
        />
      ) : (
        <SongList initialSongs={songs} userId={userData.user.id} />
      )}
    </div>
  );
}
