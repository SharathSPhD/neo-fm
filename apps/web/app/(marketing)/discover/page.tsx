/**
 * /discover -- public feed of recently-published songs (Sprint G).
 *
 * Reads directly from `public.jobs` with RLS widened to anon for
 * rows where `published_visibility in ('public','unlisted')` and
 * `public_id is not null` (migration 0013 policies). Paginated;
 * filters by style.
 *
 * Audio playback is via the public `/api/p/[publicId]/audio-url`
 * route -- we don't ship signed URLs in this server component
 * because the page is fully cacheable per filter combination.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { CoverArt } from "@/components/cover-art";
import { ProCta } from "@/components/pro-cta";
import { serverI18n } from "@/lib/i18n/server";
import { SongOfTheDay } from "@/components/song-of-the-day";
import { TopThisWeek } from "@/components/top-this-week";
import { normalizeChartLang } from "@/lib/charts/pick";
import { ForYou } from "./for-you";
import { createServerClient } from "@/lib/supabase/server";
import { prettyLanguage, prettyStyle } from "@/lib/song/labels";
import { jsonLdString, musicPlaylistLd } from "@/lib/seo/jsonld";
import { siteUrl } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

// v1.4 Sprint 15: filter chips now cover every style_family the
// Zod `StyleFamilySchema` recognises (sanskrit-shloka,
// bengali-rabindrasangeet, telugu-keerthana joined the family in
// v1.4 Sprint 2; the chips list lagged until Sprint 15).
const STYLE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All styles" },
  { value: "carnatic", label: "Carnatic" },
  { value: "hindustani", label: "Hindustani" },
  { value: "kannada-folk", label: "Kannada folk" },
  { value: "kannada-light-classical", label: "Kannada bhavageete" },
  { value: "tamil-folk", label: "Tamil folk" },
  { value: "bollywood-ballad", label: "Bollywood ballad" },
  { value: "sanskrit-shloka", label: "Sanskrit shloka" },
  { value: "bengali-rabindrasangeet", label: "Bengali Rabindrasangeet" },
  { value: "telugu-keerthana", label: "Telugu keerthana" },
  { value: "western", label: "Western" },
];

const ALLOWED_STYLES = new Set(
  STYLE_OPTIONS.map((o) => o.value).filter(Boolean),
);

type SearchParams = { style?: string; page?: string; chart?: string };

export const metadata: Metadata = {
  alternates: { canonical: "/discover" },
  title: "Discover -- neo-fm",
  description:
    "Recently-published songs from the neo-fm community. Carnatic, Hindustani, Kannada folk, and Western.",
};

type DiscoverRow = {
  id: string;
  public_id: string;
  published_at: string | null;
  user_id: string;
  song_documents: {
    title: string | null;
    language: string;
    style_family: string;
  } | null;
  // v1.4 live-bug closeout: discover only surfaces rows that already
  // have at least one track. Without `!inner` here, seeded catalog
  // jobs (status=completed, zero tracks) showed up on /discover and
  // then lied to the user on /s/<publicId> with "still being prepared".
  tracks: { id: string }[];
  cover_art:
    | {
        url: string;
        is_current: boolean;
        created_at: string;
      }[]
    | null;
};

export default async function DiscoverPage(
  props: {
    searchParams: Promise<SearchParams>;
  }
) {
  const searchParams = await props.searchParams;
  const { t } = await serverI18n();
  const supabase = createServerClient();
  const style = ALLOWED_STYLES.has(searchParams.style ?? "")
    ? (searchParams.style as string)
    : null;
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("jobs")
    .select(
      `
      id, public_id, published_at, user_id,
      song_documents!inner ( title, language, style_family ),
      tracks!inner ( id ),
      cover_art ( url, is_current, created_at )
    `,
    )
    .eq("status", "completed")
    .eq("published_visibility", "public")
    .not("public_id", "is", null);

  if (style) {
    query = query.eq("song_documents.style_family" as never, style as never);
  }

  const { data, error } = await query
    .order("published_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + PAGE_SIZE - 1)
    .returns<DiscoverRow[]>();

  // Pre-sign cover-art URLs server-side so the rendered cards already
  // have an immediately-renderable src. We do this here rather than in a
  // client effect because the discover feed is fully SSR'd for SEO.
  const coverApi = supabase.storage.from("cover-art");
  const COVER_BUCKET_PREFIX = "cover-art/";
  const COVER_TTL_SECONDS = 60 * 60;
  const coverUrlByJob = new Map<string, string | null>();
  await Promise.all(
    (data ?? []).map(async (row) => {
      const coverRow =
        (row.cover_art ?? [])
          .slice()
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .find((c) => c.is_current) ??
        (row.cover_art ?? [])
          .slice()
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      if (!coverRow?.url) {
        coverUrlByJob.set(row.id, null);
        return;
      }
      const path = coverRow.url.startsWith(COVER_BUCKET_PREFIX)
        ? coverRow.url.slice(COVER_BUCKET_PREFIX.length)
        : coverRow.url;
      const { data: signed } = await coverApi.createSignedUrl(
        path,
        COVER_TTL_SECONDS,
      );
      coverUrlByJob.set(row.id, signed?.signedUrl ?? null);
    }),
  );

  // Optional follow-on: handles for each author. Single small lookup
  // batched into one query against the unauthenticated view.
  const authorIds = Array.from(
    new Set((data ?? []).map((r) => r.user_id).filter(Boolean)),
  );
  let handleMap: Record<string, string> = {};
  if (authorIds.length > 0) {
    const profileRows = await (
      supabase.from("public_profiles" as never) as unknown as {
        select: (s: string) => {
          in: (
            col: string,
            vals: string[],
          ) => Promise<{
            data: { id: string; handle: string | null }[] | null;
          }>;
        };
      }
    )
      .select("id, handle")
      .in("id", authorIds);
    for (const row of profileRows.data ?? []) {
      if (row.handle) handleMap[row.id] = row.handle;
    }
  }

  // The unfiltered first page is the canonical collection; filtered and later pages are views of it.
  const playlistLd =
    page === 1 && !style && (data ?? []).length > 0
      ? musicPlaylistLd({
          base: siteUrl(),
          path: "/discover",
          name: "Songs from the neo-fm community",
          description: "Recently published songs in Indian languages, generated on neo-fm.",
          tracks: (data ?? []).map((row) => ({
            publicId: row.public_id,
            name: row.song_documents?.title?.trim() || (row.song_documents ? `${prettyStyle(row.song_documents.style_family)} song` : "Song"),
            language: row.song_documents?.language ?? "en",
          })),
        })
      : null;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12">
      {playlistLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(playlistLd) }} />
      ) : null}
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-widest text-foreground/40">
          {t("nav.discover")}
        </p>
        <h1 className="text-4xl font-medium tracking-tight">
          {t("discover.title")}
        </h1>
        <p className="text-base text-foreground/60">
          {t("discover.intro")}
        </p>
      </header>

      <ProCta compact />

      {page === 1 && !style ? (
        <>
          <SongOfTheDay />
          <TopThisWeek lang={normalizeChartLang(searchParams.chart)} />
          <ForYou />
        </>
      ) : null}

      <nav
        aria-label={t("discover.styleFilter")}
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        {STYLE_OPTIONS.map((o) => {
          const active = (o.value || null) === style;
          const href = o.value
            ? `/discover?style=${encodeURIComponent(o.value)}`
            : "/discover";
          return (
            <Link
              key={o.value || "all"}
              href={href}
              className={
                active
                  ? "rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-accent"
                  : "rounded-full border border-muted/30 px-3 py-1.5 text-foreground/70 hover:border-accent/30 hover:text-foreground"
              }
            >
              {o.value ? o.label : t("discover.allStyles")}
            </Link>
          );
        })}
      </nav>

      {error ? (
        <p className="rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          {t("discover.feedError")} {error.message}
        </p>
      ) : !data || data.length === 0 ? (
        <p className="rounded-md border border-dashed border-muted/30 px-6 py-12 text-center text-sm text-foreground/60">
          {t("discover.empty")}{" "}
          <Link href="/songs/new" className="underline">
            {t("discover.emptyCta")}
          </Link>
          .
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data.map((row) => {
            const doc = row.song_documents;
            const title =
              doc?.title?.trim() ||
              (doc ? t("discover.styleSong", { style: prettyStyle(doc.style_family) }) : t("song.song"));
            const author = handleMap[row.user_id];
            const coverUrl = coverUrlByJob.get(row.id) ?? null;
            return (
              <li key={row.id} className="group flex flex-col gap-2">
                <Link
                  href={`/s/${row.public_id}`}
                  className="relative block aspect-square overflow-hidden glass glass-hover rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={t("discover.openPublic", { title })}
                >
                  <CoverArt
                    url={coverUrl}
                    seed={row.public_id}
                    styleFamily={doc?.style_family ?? null}
                    alt={title}
                  />
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 via-black/15 to-transparent opacity-0 transition group-hover:opacity-100"
                  />
                </Link>
                <div className="flex flex-col gap-0.5">
                  <Link
                    href={`/s/${row.public_id}`}
                    className="line-clamp-1 text-sm font-medium text-foreground hover:text-accent"
                    title={title}
                  >
                    {title}
                  </Link>
                  <p className="text-xs text-foreground/55">
                    {doc ? prettyStyle(doc.style_family) : "—"}
                    {doc ? ` · ${prettyLanguage(doc.language)}` : ""}
                  </p>
                  {author ? (
                    <p className="text-xs text-foreground/50">
                      {t("discover.by")}{" "}
                      <Link
                        href={`/u/${author}`}
                        className="underline hover:text-foreground"
                      >
                        @{author}
                      </Link>
                    </p>
                  ) : (
                    <p className="text-xs text-foreground/40">{t("discover.byAnon")}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data && data.length === PAGE_SIZE ? (
        <DiscoverPagination current={page} style={style} hasNext={true} />
      ) : page > 1 ? (
        <DiscoverPagination current={page} style={style} hasNext={false} />
      ) : null}
    </main>
  );
}

async function DiscoverPagination({
  current,
  style,
  hasNext,
}: {
  current: number;
  style: string | null;
  hasNext: boolean;
}) {
  const { t } = await serverI18n();
  function pageHref(p: number) {
    const params = new URLSearchParams();
    if (style) params.set("style", style);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/discover?${qs}` : "/discover";
  }
  return (
    <nav
      aria-label={t("discover.pagination")}
      className="flex items-center justify-center gap-2 pt-2 text-sm"
    >
      {current > 1 ? (
        <Link
          href={pageHref(current - 1)}
          className="rounded-md border border-muted/30 px-3 py-1.5 hover:border-accent/30"
        >
          {t("common.prev")}
        </Link>
      ) : null}
      <span className="px-3 text-foreground/60">{t("common.page", { n: current })}</span>
      {hasNext ? (
        <Link
          href={pageHref(current + 1)}
          className="rounded-md border border-muted/30 px-3 py-1.5 hover:border-accent/30"
        >
          {t("common.next")}
        </Link>
      ) : null}
    </nav>
  );
}
