/**
 * /ai-songs/<language>/how-it-works -- "how neo-fm makes a song", written in the page's language.
 * Content and its sources of truth: lib/seo/language-articles.ts.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LANGUAGE_ARTICLES, articlePath } from "@/lib/seo/language-articles";
import { LANGUAGE_PAGES, languagePageBySlug, languagePagePath } from "@/lib/seo/language-pages";
import { articleLd, jsonLdString } from "@/lib/seo/jsonld";
import { siteUrl } from "@/lib/seo/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return LANGUAGE_PAGES.map((p) => ({ lang: p.slug }));
}

export function generateMetadata({ params }: { params: { lang: string } }): Metadata {
  const page = languagePageBySlug(params.lang);
  if (!page) notFound();
  const a = LANGUAGE_ARTICLES[page.code];
  // A child's own openGraph replaces the parent segment's file-based image, so point at it explicitly.
  const image = `${languagePagePath(page)}/opengraph-image`;
  return {
    title: a.title,
    description: a.description,
    alternates: { canonical: articlePath(page) },
    openGraph: { title: a.title, description: a.description, type: "article", locale: page.code, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: a.title, description: a.description, images: [image] },
  };
}

export default function HowItWorks({ params }: { params: { lang: string } }) {
  const page = languagePageBySlug(params.lang);
  if (!page) notFound();
  const a = LANGUAGE_ARTICLES[page.code];
  const ld = articleLd({
    base: siteUrl(),
    path: articlePath(page),
    headline: a.h1,
    description: a.description,
    language: page.code,
    sections: a.sections.map((s) => s.heading),
  });

  return (
    <main lang={page.code} className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={languagePagePath(page)} className="text-foreground/60 underline hover:text-foreground">
          {a.back}
        </Link>
      </nav>
      <article className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <h1 className="text-4xl font-medium leading-tight tracking-tight">{a.h1}</h1>
          <p className="text-lg text-foreground/80">{a.intro}</p>
        </header>
        {a.sections.map((s) => (
          <section key={s.heading} className="flex flex-col gap-2">
            <h2 className="text-xl font-medium tracking-tight">{s.heading}</h2>
            <p className="text-foreground/85">{s.body}</p>
          </section>
        ))}
        <aside className="rounded-xl border border-muted/40 p-5">
          <h2 className="text-lg font-medium">{a.honestHeading}</h2>
          <p className="mt-2 text-sm text-foreground/80">{a.honest}</p>
        </aside>
      </article>
      <div>
        <Link
          href="/sign-up"
          className="inline-block rounded-md bg-accent px-5 py-2.5 font-medium text-background hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
        >
          {a.cta}
        </Link>
      </div>
    </main>
  );
}
