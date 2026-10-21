import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SHOWCASE_LANGS, meanDims, showcaseCases, showcaseEnabled, signP, tally, type ShowcaseCase, type ShowcaseJudge } from "@/lib/lab/showcase";

export const metadata: Metadata = {
  title: "Lyric quality showcase -- neo-fm",
  description: "The same brief at Standard and Premium lyric grade, with blind AI-judge scores.",
  robots: { index: false, follow: false },
};

const DIMS = ["prosody", "diction", "imagery", "cultural", "originality"] as const;
const WIN: Record<string, string> = { premium: "Premium won", standard: "Standard won", tie: "Tie" };

const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

function verdict(j: ShowcaseJudge): string {
  if (j.unparsed) return "no usable verdict";
  return `${WIN[j.winner]}${j.diff == null ? "" : ` (${signed(j.diff)})`}`;
}

function Scoreboard({ cases }: { cases: ShowcaseCase[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
    <table className="w-full min-w-[34rem] text-left text-sm">
      <thead>
        <tr className="text-foreground/60">
          <th className="py-1 pr-3 font-medium">Judge</th>
          <th className="py-1 pr-3 font-medium">Premium W-L-T</th>
          <th className="py-1 pr-3 font-medium">Sign test p</th>
          {DIMS.map((d) => (
            <th key={d} className="py-1 pr-3 font-medium capitalize">{d}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(["claude", "gemini"] as const).map((fam) => {
          const t = tally(cases, fam);
          const dims = meanDims(cases, fam);
          return (
            <tr key={fam} className="border-t border-foreground/10">
              <td className="py-1 pr-3 capitalize">{fam}</td>
              <td className="py-1 pr-3">{t.premium}-{t.standard}-{t.tie}</td>
              <td className="py-1 pr-3">{signP(t.premium, t.standard) < 0.001 ? "<0.001" : signP(t.premium, t.standard).toFixed(3)}</td>
              {DIMS.map((d) => (
                <td key={d} className="py-1 pr-3">{signed(dims[d] ?? 0)}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function Lyric({ title, sub, text }: { title: string; sub: string; text: string }) {
  return (
    <div className="rounded-lg border border-foreground/10 p-4">
      <h4 className="font-medium">{title}</h4>
      <p className="text-xs text-foreground/60">{sub}</p>
      <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed">{text}</pre>
    </div>
  );
}

export default async function ShowcasePage(props: { searchParams: Promise<{ lang?: string }> }) {
  if (!showcaseEnabled()) notFound();
  const { lang: asked } = await props.searchParams;
  const lang = SHOWCASE_LANGS.find((l) => l.code === asked)?.code ?? "kn";
  const all = showcaseCases();
  const cases = all.filter((c) => c.lang === lang);
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Lyric quality showcase</h1>
      <p className="mt-3 max-w-2xl text-foreground/70">
        The same brief, written at two lyric grades from the same first draft. Every pair was judged blind, in both orders, by two
        different AI judges. These are AI judges only; no native-speaker panel has read them yet.
      </p>
      <ul className="mt-4 max-w-2xl space-y-1 text-sm text-foreground/70">
        <li><b>Standard</b>: Sonnet polish, what most songs get today.</li>
        <li><b>Premium</b>: Opus polish with exemplars from our judged corpus.</li>
        <li><b>Studio</b>: Opus drafts, pick and polish. Not built or judged yet, so not shown.</li>
      </ul>
      <nav className="mt-8 flex flex-wrap gap-2" aria-label="Language">
        {SHOWCASE_LANGS.map((l) => (
          <a
            key={l.code}
            href={`?lang=${l.code}`}
            aria-current={l.code === lang ? "page" : undefined}
            className={`rounded-full border px-4 py-1 text-sm ${l.code === lang ? "bg-foreground text-background" : "border-foreground/20"}`}
          >
            {l.name} ({all.filter((c) => c.lang === l.code).length})
          </a>
        ))}
        <span className="rounded-full border border-dashed border-foreground/20 px-4 py-1 text-sm text-foreground/50" title="No English cases have been judged at Premium yet">
          English: not judged yet
        </span>
      </nav>
      <section className="mt-6" aria-label="Scores">
        <h2 className="text-lg font-medium">Scores, {SHOWCASE_LANGS.find((l) => l.code === lang)?.name}</h2>
        <p className="text-sm text-foreground/60">Premium against Standard on the same draft. Score differences are Premium minus Standard, averaged per dimension. Claude and Gemini are shown separately.</p>
        <Scoreboard cases={cases} />
        <p className="mt-2 text-xs text-foreground/50">Across both languages ({all.length} cases): Claude {(() => { const t = tally(all, "claude"); return `${t.premium}-${t.standard}-${t.tie}`; })()}, Gemini {(() => { const t = tally(all, "gemini"); return `${t.premium}-${t.standard}-${t.tie}`; })()}. One Claude verdict was unparseable and counts as a tie.</p>
      </section>
      <section className="mt-10 space-y-10">
        {cases.map((c) => (
          <article key={c.id} id={c.id}>
            <h3 className="text-lg font-medium">{c.brief}</h3>
            <p className="text-xs text-foreground/60">{c.style} · Claude: {verdict(c.judges.claude)} · Gemini: {verdict(c.judges.gemini)}</p>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <Lyric title="Standard" sub="Sonnet polish" text={c.standard} />
              <Lyric title="Premium" sub="Opus polish with corpus exemplars" text={c.premium} />
            </div>
          </article>
        ))}
      </section>
      <p className="mt-12 text-xs text-foreground/50">AI-written and AI-judged. All cases from the lab runs of 21 Oct 2026 are shown, wins and losses alike.</p>
    </main>
  );
}
