import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";

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

  const songs = (data ?? []).map((row) => {
    const latestTrack = (row.tracks ?? [])
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
    return {
      id: row.id,
      status: row.status,
      error: row.error,
      created_at: row.created_at,
      language: row.song_documents?.language ?? null,
      style_family: row.song_documents?.style_family ?? null,
      audio_url: latestTrack?.url ?? null,
      duration_seconds: latestTrack?.duration_seconds ?? null,
    };
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-medium tracking-tight">Library</h1>
          <p className="text-sm text-foreground/60">
            Your latest songs. Free tier caps at 3 per month.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/songs/new"
            className="rounded-md border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20"
          >
            New song
          </Link>
          <form action="/sign-out" method="post">
            <button
              type="submit"
              className="rounded-md border border-muted/30 px-3 py-2 text-sm text-foreground/70 hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {error ? (
        <p className="rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          Couldn&apos;t load songs: {error.message}
        </p>
      ) : (
        <SongList initialSongs={songs} userId={userData.user.id} />
      )}
    </main>
  );
}
