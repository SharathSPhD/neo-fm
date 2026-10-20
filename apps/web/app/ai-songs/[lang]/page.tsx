/**
 * /ai-songs/<language> -- landing page per supported language.
 *
 * Statically generated for the five slugs; anything else is a 404. Copy
 * lives in lib/seo/language-pages.ts. The top songs are public songs in
 * that language, cached for ten minutes. Each page is in the hreflang
 * cluster with the landing page and its siblings.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  LANGUAGE_PAGES,
  hreflangPaths,
  languagePageBySlug,
  languagePagePath,
} from "@/lib/seo/language-pages";
import { LANGUAGE_ARTICLES, articlePath } from "@/lib/seo/language-articles";
import { jsonLdString, musicPlaylistLd } from "@/lib/seo/jsonld";
import { poolTracksIndexable, trackIndexable } from "@/lib/seo/pool-tracks";
import { siteUrl } from "@/lib/seo/site";
import { loadPool } from "@/lib/station/pool";
import { loadTopSongs } from "@/lib/seo/top-songs";

export const revalidate = 600;
export const dynamicParams = false;

const TOP_COUNT = 12;

export function generateStaticParams() {
  return LANGUAGE_PAGES.map((p) => ({ lang: p.slug }));
}

export async function generateMetadata(props: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const params = await props.params;
  const page = languagePageBySlug(params.lang);
  // Unknown slugs must 404 here too: with a route-level loading state the page body streams after the status line.
  if (!page) notFound();
  return {
    title: page.title,
    description: page.intro,
    alternates: { canonical: languagePagePath(page), languages: hreflangPaths() },
    openGraph: { title: page.title, description: page.intro, type: "website", locale: page.code },
    twitter: { card: "summary", title: page.title, description: page.intro },
  };
}

export default async function LanguageLanding(props: { params: Promise<{ lang: string }> }) {
  const params = await props.params;
  const page = languagePageBySlug(params.lang);
  if (!page) notFound();

  const songs = await loadTopSongs(page.code, TOP_COUNT).catch(() => []);
  // Station tracks fill the page while community songs are few; listed only while SEO_POOL_TRACKS is on.
  const stationTracks = poolTracksIndexable()
    ? (await loadPool().catch(() => [])).filter((t) => t.language === page.code && t.kind === "vocal" && trackIndexable(t.language)).slice(0, TOP_COUNT)
    : [];
  const ld = musicPlaylistLd({
    base: siteUrl(),
    path: languagePagePath(page),
    name: page.songsHeading,
    description: page.intro,
    language: page.code,
    tracks: songs.map((s) => ({ publicId: s.publicId, name: s.title, language: s.language })),
  });

  return (
    <main lang={page.code} className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <header className="flex flex-col gap-4">
        <h1 className="text-4xl font-medium leading-tight tracking-tight">{page.h1}</h1>
        <p className="max-w-prose text-lg text-foreground/80">{page.intro}</p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/station?utm_source=seo&utm_medium=organic&utm_campaign=lang-${page.code}`}
            className="rounded-md bg-accent px-5 py-2.5 font-medium text-background hover:bg-accent/90 focus:outline-hidden focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
          >
            {page.listen}
          </Link>
          <Link
            href="/sign-up"
            className="rounded-md border border-accent/60 px-5 py-2.5 font-medium text-accent hover:bg-accent/10 focus:outline-hidden focus:ring-2 focus:ring-accent"
          >
            {page.cta}
          </Link>
          <Link
            href="/discover"
            className="rounded-md border border-muted/50 px-5 py-2.5 font-medium text-foreground/90 hover:border-foreground/60 hover:text-foreground focus:outline-hidden focus:ring-2 focus:ring-accent"
          >
            {page.browse}
          </Link>
        </div>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2">
        {page.points.map((point) => (
          <li key={point} className="rounded-xl border border-muted/50 p-4 text-sm text-foreground/85">
            {point}
          </li>
        ))}
      </ul>

      <section aria-labelledby="top-songs" className="flex flex-col gap-4">
        <h2 id="top-songs" className="text-2xl font-medium tracking-tight">
          {page.songsHeading}
        </h2>
        {songs.length === 0 && stationTracks.length === 0 ? (
          <p className="text-sm text-foreground/60">{page.empty}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {songs.map((s) => (
              <li key={s.publicId}>
                <Link
                  href={`/s/${s.publicId}`}
                  className="block rounded-xl border border-muted/50 p-4 transition hover:border-accent/60 focus:outline-hidden focus:ring-2 focus:ring-accent"
                >
                  <p className="line-clamp-2 font-medium">{s.title}</p>
                  <p className="mt-1 text-xs text-foreground/60">{s.style}</p>
                  <p className="mt-3 text-xs text-accent">{page.play}</p>
                </Link>
              </li>
            ))}
            {stationTracks.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/t/${t.id}`}
                  className="block rounded-xl border border-muted/50 p-4 transition hover:border-accent/60 focus:outline-hidden focus:ring-2 focus:ring-accent"
                >
                  <p className="line-clamp-2 font-medium">{t.title}</p>
                  <p className="mt-3 text-xs text-accent">{page.play}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p>
        <Link href={articlePath(page)} className="text-accent underline">
          {LANGUAGE_ARTICLES[page.code].readMore} →
        </Link>
      </p>

      <nav aria-label="Languages" className="flex flex-wrap gap-x-4 gap-y-2 border-t border-muted/30 pt-6 text-sm">
        {LANGUAGE_PAGES.map((p) => (
          <Link
            key={p.code}
            href={languagePagePath(p)}
            hrefLang={p.code}
            lang={p.code}
            aria-current={p.code === page.code ? "page" : undefined}
            className={p.code === page.code ? "text-foreground" : "text-foreground/60 underline hover:text-foreground"}
          >
            {p.native}
          </Link>
        ))}
      </nav>
    </main>
  );
}
