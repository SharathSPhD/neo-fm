/**
 * /help -- FAQ grounded in /pricing, /terms, /privacy and /trust (content: lib/help/faq.ts).
 * `?lang=hi|ta|te|kn|bn` (else the site language cookie) shows a machine translation with a notice; English is authoritative.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { getUiLang } from "@/lib/i18n/server";
import { HELP_COPY, HELP_LANGS, HELP_LANG_NAMES, MORE_LINKS, parseHelpLang, SECTIONS } from "@/lib/help/faq";

export const metadata: Metadata = {
  alternates: { canonical: "/help" },
  title: "Help -- neo-fm",
  description:
    "How neo-fm makes songs, what each plan includes, who owns your songs, languages supported, and how safety and takedowns work.",
};

export default async function HelpPage(props: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const { lang: q } = await props.searchParams;
  const lang = parseHelpLang(q ?? (await getUiLang()));
  const copy = HELP_COPY[lang];
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-3">
        <h1 lang={lang} className="text-4xl font-medium tracking-tight">{copy.title}</h1>
        <p lang={lang} className="text-base text-foreground/60">{copy.intro}</p>
        <nav aria-label="Language" className="flex flex-wrap gap-2 text-sm">
          {HELP_LANGS.map((l) => (
            <Link
              key={l}
              href={l === "en" ? "/help" : `/help?lang=${l}`}
              lang={l}
              hrefLang={l}
              aria-current={l === lang ? "page" : undefined}
              className={`rounded-full border px-3 py-1 ${l === lang ? "border-accent/60 bg-accent/10 text-accent" : "border-muted/30 text-foreground/70 hover:border-muted/60"}`}
            >
              {HELP_LANG_NAMES[l]}
            </Link>
          ))}
        </nav>
        {copy.machineNotice ? (
          <p lang={lang} role="note" className="rounded-md border border-muted/30 bg-muted/5 px-4 py-3 text-sm text-foreground/70">
            {copy.machineNotice}{" "}
            <Link href="/help" lang="en" className="underline">English</Link>
          </p>
        ) : null}
      </header>
      {SECTIONS.map((s) => (
        <section key={s.id} lang={lang} aria-labelledby={`h-${s.id}`} className="flex flex-col gap-4">
          <h2 id={`h-${s.id}`} className="text-xl font-medium">{copy.sections[s.id]}</h2>
          {s.items.map((id) => {
            const item = copy.items[id];
            const more = MORE_LINKS[id];
            return (
              <details key={id} className="group rounded-md border border-muted/20 bg-muted/5 px-5 py-4 open:border-muted/40">
                <summary className="flex cursor-pointer list-none items-start gap-3 text-base font-medium text-foreground/90">
                  <span aria-hidden="true" className="mt-0.5 text-accent transition group-open:rotate-90">▸</span>
                  <span>{item.q}</span>
                </summary>
                <div className="mt-3 pl-6 text-sm text-foreground/75">
                  <p>{item.a}</p>
                  {more ? (
                    <p className="mt-2">
                      <Link href={more} lang="en" className="underline">{copy.readMore}</Link>
                    </p>
                  ) : null}
                </div>
              </details>
            );
          })}
        </section>
      ))}
      <p className="text-sm text-foreground/60">
        <Link href="/feedback" className="underline">Contact / feedback</Link>
      </p>
    </main>
  );
}
