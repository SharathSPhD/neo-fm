/**
 * /library -- now with search, filters, sort, pagination, favorites,
 * rename, and delete (Sprint F).
 *
 * The query stays server-rendered for the initial paint -- searching
 * and paginating make a fresh request. Realtime row updates still
 * happen in the client component once mounted.
 */
import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";

import { LibraryToolbar } from "./toolbar";
import { LibraryOnboardingModal } from "./onboarding-modal";
import { Pagination } from "./pagination";
import { SongGrid } from "./song-grid";
import { SongList } from "./song-list";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

type RawJobRow = {
  id: string;
  status: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  is_favorite: boolean | null;
  song_documents:
    | {
        id: string;
        language: string;
        style_family: string;
        title: string | null;
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
  cover_art:
    | {
        url: string;
        is_current: boolean;
        created_at: string;
      }[]
    | null;
};

type SearchParams = {
  q?: string;
  style?: string;
  lang?: string;
  status?: string;
  sort?: string;
  fav?: string;
  page?: string;
  view?: string;
};

const ALLOWED_VIEWS = new Set(["grid", "list"]);

const ALLOWED_STYLES = new Set([
  "carnatic",
  "hindustani",
  "kannada-folk",
  "western",
]);
const ALLOWED_LANGUAGES = new Set(["en", "hi", "kn"]);
const ALLOWED_STATUSES = new Set(["queued", "processing", "completed", "failed"]);
const ALLOWED_SORTS = new Set([
  "newest",
  "oldest",
  "duration_asc",
  "duration_desc",
  "favorites",
]);

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = createServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect("/sign-in?next=/library");

  const q = (searchParams.q ?? "").trim().slice(0, 80);
  const style = ALLOWED_STYLES.has(searchParams.style ?? "")
    ? (searchParams.style as string)
    : null;
  const lang = ALLOWED_LANGUAGES.has(searchParams.lang ?? "")
    ? (searchParams.lang as string)
    : null;
  const status = ALLOWED_STATUSES.has(searchParams.status ?? "")
    ? (searchParams.status as string)
    : null;
  const sort = ALLOWED_SORTS.has(searchParams.sort ?? "")
    ? (searchParams.sort as string)
    : "newest";
  const favOnly = searchParams.fav === "1";
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const view = ALLOWED_VIEWS.has(searchParams.view ?? "")
    ? (searchParams.view as "grid" | "list")
    : "grid";

  // Build the count query separately from the row query so we can
  // show "showing X of Y" without fetching every row.
  let countQuery = supabase
    .from("jobs")
    .select("id, song_documents!inner(language, style_family, title)", {
      count: "exact",
      head: true,
    })
    .eq("user_id", userData.user.id);

  // Filter columns belong to a joined table or are typed as enums.
  // We've already validated the values against the allowlists above,
  // so casting via `as never` to relax the strict enum typing is safe.
  if (style) countQuery = countQuery.eq("song_documents.style_family" as never, style as never);
  if (lang) countQuery = countQuery.eq("song_documents.language" as never, lang as never);
  if (status) countQuery = countQuery.eq("status", status as never);
  if (favOnly) countQuery = countQuery.eq("is_favorite", true);
  if (q) countQuery = countQuery.ilike("song_documents.title" as never, `%${q}%`);
  const { count: totalCount } = await countQuery;

  let rowsQuery = supabase
    .from("jobs")
    .select(
      `
      id, status, error, created_at, finished_at, is_favorite,
      song_documents!inner ( id, language, style_family, title ),
      tracks ( url, duration_seconds, format, created_at ),
      cover_art ( url, is_current, created_at )
    `,
    )
    .eq("user_id", userData.user.id);

  if (style) rowsQuery = rowsQuery.eq("song_documents.style_family" as never, style as never);
  if (lang) rowsQuery = rowsQuery.eq("song_documents.language" as never, lang as never);
  if (status) rowsQuery = rowsQuery.eq("status", status as never);
  if (favOnly) rowsQuery = rowsQuery.eq("is_favorite", true);
  if (q) rowsQuery = rowsQuery.ilike("song_documents.title" as never, `%${q}%`);

  // Sort: duration_* requires us to fetch and sort in JS (cross-table).
  // For "newest" / "oldest" / "favorites" we sort in SQL.
  if (sort === "oldest") {
    rowsQuery = rowsQuery.order("created_at", { ascending: true });
  } else if (sort === "favorites") {
    rowsQuery = rowsQuery
      .order("is_favorite", { ascending: false })
      .order("created_at", { ascending: false });
  } else {
    rowsQuery = rowsQuery.order("created_at", { ascending: false });
  }
  rowsQuery = rowsQuery.order("created_at", {
    referencedTable: "tracks",
    ascending: false,
  });

  const offset = (page - 1) * PAGE_SIZE;
  const { data, error } = await rowsQuery
    .range(offset, offset + PAGE_SIZE - 1)
    .returns<RawJobRow[]>();

  const TRACK_BUCKET_PREFIX = "tracks/";
  const COVER_BUCKET_PREFIX = "cover-art/";
  const tracksApi = supabase.storage.from("tracks");
  const coverApi = supabase.storage.from("cover-art");
  const SIGNED_URL_TTL_SECONDS = 60 * 60;

  let songs = await Promise.all(
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
      // Pick the most-recent cover-art row marked is_current, fall back to
      // the most-recent row overall (some legacy rows pre-date the flag).
      const coverRows = (row.cover_art ?? []).slice().sort((a, b) =>
        a.created_at < b.created_at ? 1 : -1,
      );
      const coverRow = coverRows.find((c) => c.is_current) ?? coverRows[0];
      let coverUrl: string | null = null;
      if (coverRow?.url) {
        const path = coverRow.url.startsWith(COVER_BUCKET_PREFIX)
          ? coverRow.url.slice(COVER_BUCKET_PREFIX.length)
          : coverRow.url;
        const { data: signed } = await coverApi.createSignedUrl(
          path,
          SIGNED_URL_TTL_SECONDS,
        );
        coverUrl = signed?.signedUrl ?? null;
      }
      return {
        id: row.id,
        status: row.status,
        error: row.error,
        created_at: row.created_at,
        is_favorite: !!row.is_favorite,
        title: row.song_documents?.title ?? null,
        language: row.song_documents?.language ?? null,
        style_family: row.song_documents?.style_family ?? null,
        audio_url: audioUrl,
        duration_seconds: latestTrack?.duration_seconds ?? null,
        cover_url: coverUrl,
      };
    }),
  );

  if (sort === "duration_asc" || sort === "duration_desc") {
    songs = songs.slice().sort((a, b) => {
      const da = a.duration_seconds ?? -1;
      const db = b.duration_seconds ?? -1;
      return sort === "duration_asc" ? da - db : db - da;
    });
  }

  const total = totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <LibraryOnboardingModal />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-medium tracking-tight">Library</h1>
          <p className="text-sm text-foreground/60">
            {total === 0
              ? "No songs yet."
              : `Showing ${songs.length} of ${total} song${total === 1 ? "" : "s"}.`}
          </p>
        </div>
      </header>

      <LibraryToolbar
        defaults={{ q, style, lang, status, sort, favOnly, view }}
      />

      {error ? (
        <p className="rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          Couldn&apos;t load songs: {error.message}
        </p>
      ) : songs.length === 0 ? (
        total === 0 ? (
          <EmptyState
            title="No songs yet"
            body="Pick a style preset, type a verse, hit Generate. Your first song will land here in about a minute."
            cta={{ href: "/songs/new", label: "Create your first song" }}
          />
        ) : (
          <EmptyState
            title="No matches"
            body="Try a different style, language, or clear the search box."
          />
        )
      ) : (
        <>
          {view === "grid" ? (
            <SongGrid initialSongs={songs} userId={userData.user.id} />
          ) : (
            <SongList initialSongs={songs} userId={userData.user.id} />
          )}
          {totalPages > 1 ? (
            <Pagination current={page} total={totalPages} view={view} />
          ) : null}
        </>
      )}
    </div>
  );
}
