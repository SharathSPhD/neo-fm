import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SHOWCASE_LANGS, clipUrl, mean, meanDims, showcaseAudio, showcaseCases, showcaseEnabled, signP, tally, type AudioRender, type ShowcaseCase, type ShowcaseJudge } from "@/lib/lab/showcase";

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

function Clip({ r, label }: { r: AudioRender; label: string }) {
  const url = clipUrl(r.clip);
  return (
    <div className="flex flex-wrap items-center gap-3 py-1">
      <span className="w-32 text-sm">{label}</span>
      <span className="w-28 text-sm tabular-nums">sung-word match {r.diction}%</span>
      {url ? <audio controls preload="none" src={url} className="h-8 max-w-full" aria-label={`${label}, ${r.diction}% sung-word match`} /> : <span className="text-xs text-foreground/50">audio not hosted on this host</span>}
    </div>
  );
}

function SongsSection() {
  const { romanization, cue } = showcaseAudio();
  return (
    <section className="mt-16" aria-label="Songs">
      <h2 className="text-2xl font-semibold tracking-tight">Songs</h2>
      <p className="mt-2 max-w-2xl text-foreground/70">
        Rendered by our music model from the same lyrics, then scored. The score shown is <b>sung-word match</b>: how much of the written lyric a
        listening model could hear in the sung audio. It says nothing about accent, feel or whether the song is nice. We have no native-speaker panel
        yet, so please listen and judge for yourself.
      </p>
      <h3 className="mt-8 text-lg font-medium">Input script: native text vs Claude-written Latin spelling</h3>
      <p className="text-sm text-foreground/60">Same brief and same lyrics. Every render is listed, not just the best. 2 to 3 renders per arm, one brief per language: small samples.</p>
      <div className="mt-4 space-y-8">
        {romanization.map((g) => (
          <article key={g.brief}>
            <h4 className="font-medium">{g.language}, occasion brief {g.brief}</h4>
            <div className="mt-2 grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-foreground/10 p-4">
                <p className="text-sm font-medium">Native text as input <span className="font-normal text-foreground/60">· mean {mean(g.stock.map((r) => r.diction)).toFixed(0)}%</span></p>
                {g.stock.map((r, i) => <Clip key={r.clip} r={r} label={`Render ${i + 1}`} />)}
              </div>
              <div className="rounded-lg border border-foreground/10 p-4">
                <p className="text-sm font-medium">Claude-written Latin spelling <span className="font-normal text-foreground/60">· mean {mean(g.romanized.map((r) => r.diction)).toFixed(0)}%</span></p>
                {g.romanized.map((r, i) => <Clip key={r.clip} r={r} label={`Render ${i + 1}`} />)}
              </div>
            </div>
            <details className="mt-2 text-sm text-foreground/70">
              <summary className="cursor-pointer">Lyrics</summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans">{g.lyrics}</pre>
            </details>
          </article>
        ))}
      </div>
      <h3 className="mt-12 text-lg font-medium">Style prompt: plain line vs catalog cue</h3>
      <p className="text-sm text-foreground/60">
        The cue adds instruments, tempo and feel. It barely changes how the song sounds (audio similarity 0.97 to 0.99), and no free score separates the two
        beyond render-to-render noise. The preference score comes from a model that is right about 61.5% of the time, so read it as a weak hint.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead>
            <tr className="text-foreground/60">
              <th className="py-1 pr-3 font-medium">Brief</th>
              <th className="py-1 pr-3 font-medium">Plain</th>
              <th className="py-1 pr-3 font-medium">Cue</th>
              <th className="py-1 pr-3 font-medium">Preference (cue minus plain)</th>
              <th className="py-1 pr-3 font-medium">Audio quality (cue minus plain)</th>
            </tr>
          </thead>
          <tbody>
            {cue.map((p) => (
              <tr key={p.brief} className="border-t border-foreground/10 align-top">
                <td className="py-2 pr-3">{p.language}, {p.brief}</td>
                <td className="py-2 pr-3"><Clip r={p.stock} label="Plain" /></td>
                <td className="py-2 pr-3"><Clip r={p.cue} label="Cue" /></td>
                <td className="py-2 pr-3 tabular-nums">{p.scores.pref_logit >= 0 ? "+" : ""}{p.scores.pref_logit.toFixed(2)}</td>
                <td className="py-2 pr-3 tabular-nums">{p.scores.audiobox_pq >= 0 ? "+" : ""}{p.scores.audiobox_pq.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-6 text-xs text-foreground/50">
        Lab renders from 20 to 21 Oct 2026, made for testing and not released songs. Scores are AI-computed. Kannada plain-input renders score low by design of
        that input path. Library songs from our station pool are not shown here yet.
      </p>
    </section>
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
      <SongsSection />
      <p className="mt-12 text-xs text-foreground/50">AI-written and AI-judged. All cases from the lab runs of 21 Oct 2026 are shown, wins and losses alike. Both grades start from the same short first draft, written before a token-limit fix, so some drafts are brief.</p>
    </main>
  );
}
