/**
 * /ideas -- public gallery of starter prompts: 20 per launch language, written natively in each script with an
 * English gloss. Filters (language, occasion, mood) are plain links, so the page needs no client JS, every view is
 * shareable, and it works before hydration. "Use this idea" goes to /songs/new?idea=<id>; that route sends signed-out
 * visitors through sign-in and back with the idea intact.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { ideasFor } from "@/lib/ideas/catalog";
import {
  facetCounts,
  filterIdeas,
  IDEA_LANGS,
  IDEA_LANG_NAME,
  isIdeaLang,
  MOODS,
  MOOD_LABEL,
  OCCASIONS,
  OCCASION_LABEL,
  type IdeaLang,
  type Mood,
  type Occasion,
} from "@/lib/ideas/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Song ideas in Hindi, Kannada, Tamil, Telugu and Bengali · neo-fm",
  description:
    "Culturally rooted starter prompts for festivals, lullabies, love, devotion, monsoon, cricket, weddings and city life. Written natively in each script, with English glosses.",
  alternates: { canonical: "/ideas" },
};

type Search = { lang?: string; occasion?: string; mood?: string };

function pick<T extends string>(v: string | undefined, all: readonly T[]): T | null {
  return v && (all as readonly string[]).includes(v) ? (v as T) : null;
}

function href(lang: IdeaLang, occasion: Occasion | null, mood: Mood | null): string {
  const q = new URLSearchParams({ lang });
  if (occasion) q.set("occasion", occasion);
  if (mood) q.set("mood", mood);
  return `/ideas?${q.toString()}`;
}

const chip = (active: boolean, disabled = false) =>
  `rounded-full border px-3 py-1 text-sm transition focus:outline-none focus:ring-2 focus:ring-accent ${
    active
      ? "border-accent bg-accent/15 text-accent"
      : disabled
        ? "pointer-events-none border-muted/20 text-foreground/60"
        : "border-muted/40 text-foreground/80 hover:border-foreground/50"
  }`;

export default async function IdeasPage(props: { searchParams: Promise<Search> }) {
  const searchParams = await props.searchParams;
  const lang: IdeaLang = isIdeaLang(searchParams.lang) ? searchParams.lang : "hi";
  const occasion = pick<Occasion>(searchParams.occasion, OCCASIONS);
  const mood = pick<Mood>(searchParams.mood, MOODS);

  const all = ideasFor(lang);
  const shown = filterIdeas(all, { occasion, mood });
  const counts = facetCounts(all, { occasion, mood });
  const langName = IDEA_LANG_NAME[lang].name;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight">Song ideas</h1>
        <p className="mt-3 text-lg text-foreground/75">
          Twenty starting points in each language, rooted in how people actually celebrate, grieve, court and commute. Pick one, change anything, and hear it as a song.
        </p>
        <p className="mt-4 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-foreground/80" role="note">
          <strong className="font-medium">Pending native-speaker review.</strong> These ideas were drafted with AI and have not yet been checked by native speakers of each language. Wording may be slightly off. Tell us if something reads wrong.
        </p>
      </header>

      <nav aria-label="Language" className="mt-8 flex flex-wrap gap-2">
        {IDEA_LANGS.map((l) => (
          <Link key={l} href={href(l, null, null)} aria-current={l === lang ? "page" : undefined} className={chip(l === lang)}>
            <span lang={l}>{IDEA_LANG_NAME[l].endonym}</span> <span className="text-foreground/60">{IDEA_LANG_NAME[l].name}</span>
          </Link>
        ))}
      </nav>

      <section aria-label="Filters" className="mt-6 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-baseline">
        <p className="text-xs font-medium uppercase tracking-widest text-foreground/60">Occasion</p>
        <ul className="flex flex-wrap gap-2">
          {OCCASIONS.map((o) => (
            <li key={o}>
              <Link
                href={href(lang, occasion === o ? null : o, mood)}
                aria-current={occasion === o ? "true" : undefined}
                aria-disabled={counts.occasion[o] === 0 && occasion !== o ? true : undefined}
                tabIndex={counts.occasion[o] === 0 && occasion !== o ? -1 : undefined}
                className={chip(occasion === o, counts.occasion[o] === 0 && occasion !== o)}
              >
                {OCCASION_LABEL[o]} <span className="text-foreground/60">{counts.occasion[o]}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs font-medium uppercase tracking-widest text-foreground/60">Mood</p>
        <ul className="flex flex-wrap gap-2">
          {MOODS.map((m) => (
            <li key={m}>
              <Link
                href={href(lang, occasion, mood === m ? null : m)}
                aria-current={mood === m ? "true" : undefined}
                aria-disabled={counts.mood[m] === 0 && mood !== m ? true : undefined}
                tabIndex={counts.mood[m] === 0 && mood !== m ? -1 : undefined}
                className={chip(mood === m, counts.mood[m] === 0 && mood !== m)}
              >
                {MOOD_LABEL[m]} <span className="text-foreground/60">{counts.mood[m]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-6 text-sm text-foreground/70" role="status">
        Showing {shown.length} of {all.length} {langName} ideas
        {occasion || mood ? (
          <>
            {" "}·{" "}
            <Link href={href(lang, null, null)} className="text-accent underline focus:outline-none focus:ring-2 focus:ring-accent">Clear filters</Link>
          </>
        ) : null}
      </p>

      {shown.length === 0 ? (
        <p className="mt-8 text-foreground/70">No ideas match both filters. Clear one to see more.</p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((i) => (
            <li key={i.id} className="flex flex-col rounded-xl border border-muted/30 bg-muted/5 p-5">
              <p lang={i.lang} className="text-lg leading-relaxed">{i.text}</p>
              <p className="mt-3 text-sm text-foreground/70">{i.gloss}</p>
              <p className="mt-3 text-xs text-foreground/60">
                {OCCASION_LABEL[i.occasion]} · {MOOD_LABEL[i.mood]}
              </p>
              <Link
                href={`/songs/new?idea=${encodeURIComponent(i.id)}`}
                className="mt-4 self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-background hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
              >
                Use this idea
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
