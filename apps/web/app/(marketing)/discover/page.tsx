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
import { createServerClient } from "@/lib/supabase/server";
import { prettyLanguage, prettyStyle } from "@/lib/song/labels";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

const STYLE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All styles" },
  { value: "carnatic", label: "Carnatic" },
  { value: "hindustani", label: "Hindustani" },
  { value: "kannada-folk", label: "Kannada folk" },
  { value: "western", label: "Western" },
];

const ALLOWED_STYLES = new Set(
  STYLE_OPTIONS.map((o) => o.value).filter(Boolean),
);

type SearchParams = { style?: string; page?: string };

export const metadata: Metadata = {
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
  cover_art:
    | {
        url: string;
        is_current: boolean;
        created_at: string;
      }[]
    | null;
};

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
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

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-widest text-foreground/40">
          discover
        </p>
        <h1 className="text-4xl font-medium tracking-tight">
          Songs from the community
        </h1>
        <p className="text-base text-foreground/60">
          Fresh public releases across Carnatic, Hindustani, Kannada folk,
          and Western. Click through to play the full track.
        </p>
      </header>

      <nav
        aria-label="Style filter"
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
                  ? "rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-accent"
                  : "rounded-full border border-muted/30 px-3 py-1 text-foreground/70 hover:border-accent/30 hover:text-foreground"
              }
            >
              {o.label}
            </Link>
          );
        })}
      </nav>

      {error ? (
        <p className="rounded-md border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          Couldn&apos;t load feed: {error.message}
        </p>
      ) : !data || data.length === 0 ? (
        <p className="rounded-md border border-dashed border-muted/30 px-6 py-12 text-center text-sm text-foreground/60">
          No songs match this filter yet. Be the first to{" "}
          <Link href="/songs/new" className="underline">
            publish one
          </Link>
          .
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data.map((row) => {
            const doc = row.song_documents;
            const title =
              doc?.title?.trim() ||
              (doc ? `${prettyStyle(doc.style_family)} song` : "Song");
            const author = handleMap[row.user_id];
            const coverUrl = coverUrlByJob.get(row.id) ?? null;
            return (
              <li key={row.id} className="group flex flex-col gap-2">
                <Link
                  href={`/s/${row.public_id}`}
                  className="relative block aspect-square overflow-hidden rounded-lg border border-muted/20 bg-muted/5 transition hover:border-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={`${title} – open public page`}
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
                      by{" "}
                      <Link
                        href={`/u/${author}`}
                        className="underline hover:text-foreground"
                      >
                        @{author}
                      </Link>
                    </p>
                  ) : (
                    <p className="text-xs text-foreground/40">by anonymous</p>
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

function DiscoverPagination({
  current,
  style,
  hasNext,
}: {
  current: number;
  style: string | null;
  hasNext: boolean;
}) {
  function pageHref(p: number) {
    const params = new URLSearchParams();
    if (style) params.set("style", style);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/discover?${qs}` : "/discover";
  }
  return (
    <nav
      aria-label="Discover pagination"
      className="flex items-center justify-center gap-2 pt-2 text-sm"
    >
      {current > 1 ? (
        <Link
          href={pageHref(current - 1)}
          className="rounded-md border border-muted/30 px-3 py-1.5 hover:border-accent/30"
        >
          ← Prev
        </Link>
      ) : null}
      <span className="px-3 text-foreground/60">Page {current}</span>
      {hasNext ? (
        <Link
          href={pageHref(current + 1)}
          className="rounded-md border border-muted/30 px-3 py-1.5 hover:border-accent/30"
        >
          Next →
        </Link>
      ) : null}
    </nav>
  );
}
