import Link from "next/link";

import { PCE_EVAL } from "@/lib/eval/pce-results";

const { judges, byLanguage, dimensions, kannadaGemini } = PCE_EVAL;

function signed(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`;
}

/** Compact version for the pricing page: one honest sentence plus a link. */
export function QualityEvidenceSummary() {
  return (
    <section
      aria-labelledby="quality-summary-heading"
      className="mx-auto max-w-3xl rounded-xl border border-muted/30 p-6 text-sm"
    >
      <h2 id="quality-summary-heading" className="text-base font-medium">
        How good are the lyrics?
      </h2>
      <p className="mt-2 text-foreground/70">
        In our internal blind test of {PCE_EVAL.briefs} briefs across five Indian
        languages, AI judges preferred our lyric engine over a strong single-model
        baseline in most comparisons ({judges.claude.pce} to {judges.claude.baseline} by
        a Claude judge, {judges.gemini.pce} to {judges.gemini.baseline} by a Gemini
        judge). The edge is in imagery, originality and cultural fit; on prosody we
        are slightly behind. No native-speaker panel has reviewed this yet.{" "}
        <Link href="/trust#quality-evidence" className="underline">
          See the full results and limits
        </Link>
        .
      </p>
    </section>
  );
}

/** Full write-up for /trust, with the limits stated next to the numbers. */
export function QualityEvidence() {
  return (
    <section
      id="quality-evidence"
      aria-labelledby="quality-heading"
      className="mt-12 rounded-lg border border-muted/30 p-5"
    >
      <h2 id="quality-heading" className="text-lg font-medium">
        Lyric quality: what we measured, and what we didn&apos;t
      </h2>
      <p className="mt-2 text-sm text-foreground/70">
        We compared lyrics from our engine (candidate generation, contrastive
        selection and a Sonnet polish) against a strong baseline (six drafts from one
        model, the best one picked and revised, same polish). {PCE_EVAL.briefs} frozen
        briefs, 30 each in Kannada, Tamil, Telugu, Hindi and Bengali. Judging was
        blind, in both orders, on prosody, diction, imagery, cultural fit and
        originality. {PCE_EVAL.pairs} pairs were scored.
      </p>

      <h3 className="mt-5 text-sm font-medium">Head to head</h3>
      <table className="mt-2 w-full text-left text-sm">
        <caption className="sr-only">Pairwise wins by judge</caption>
        <thead className="text-foreground/50">
          <tr>
            <th scope="col" className="py-1 pr-4 font-normal">Judge</th>
            <th scope="col" className="py-1 pr-4 font-normal">Our engine preferred</th>
            <th scope="col" className="py-1 font-normal">Baseline preferred</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-muted/20">
            <th scope="row" className="py-1 pr-4 font-normal">Claude Sonnet</th>
            <td className="py-1 pr-4">{judges.claude.pce}</td>
            <td className="py-1">{judges.claude.baseline}</td>
          </tr>
          <tr className="border-t border-muted/20">
            <th scope="row" className="py-1 pr-4 font-normal">Gemini (different model family)</th>
            <td className="py-1 pr-4">{judges.gemini.pce}</td>
            <td className="py-1">{judges.gemini.baseline}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-xs text-foreground/60">
        A pair counts as a win only when the scores differ by at least 1 point out of 25;
        the rest are ties.
      </p>

      <h3 className="mt-5 text-sm font-medium">By language (Claude judge)</h3>
      <table className="mt-2 w-full text-left text-sm">
        <caption className="sr-only">Pairwise wins by language, Claude judge</caption>
        <thead className="text-foreground/50">
          <tr>
            <th scope="col" className="py-1 pr-4 font-normal">Language</th>
            <th scope="col" className="py-1 pr-4 font-normal">Ours</th>
            <th scope="col" className="py-1 font-normal">Baseline</th>
          </tr>
        </thead>
        <tbody>
          {byLanguage.map((r) => (
            <tr key={r.language} className="border-t border-muted/20">
              <th scope="row" className="py-1 pr-4 font-normal">{r.language}</th>
              <td className="py-1 pr-4">{r.pceWins}</td>
              <td className="py-1">{r.baselineWins}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-foreground/60">
        Kannada is our weakest evidence: the Gemini judge split it {kannadaGemini.pce} to{" "}
        {kannadaGemini.baseline}, so we don&apos;t claim a Kannada advantage. Telugu is
        close, and Telugu pronunciation varies more from song to song than in other
        languages.
      </p>

      <h3 className="mt-5 text-sm font-medium">Where the difference comes from</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {dimensions.map((d) => (
          <li key={d.label} className="flex justify-between border-t border-muted/20 py-1">
            <span>{d.label}</span>
            <span className={d.diff < 0 ? "text-foreground/60" : ""}>{signed(d.diff)} of 5</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-foreground/60">
        Average score difference, ours minus baseline. Prosody (meter and singability of the
        words) is where we are behind, and we are working on it.
      </p>

      <h3 className="mt-5 text-sm font-medium">Limits</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground/70">
        <li>The judges are AI models. No native-speaker panel has reviewed these results yet.</li>
        <li>This measures lyrics on the page, not the sung audio, and not human songwriters.</li>
        <li>It is an internal test, not an independent audit. We don&apos;t claim our lyrics are &ldquo;the best&rdquo;.</li>
        <li>
          Without the final polish step our raw output lost to the baseline in an earlier check,
          so polish is part of the product.
        </li>
        <li>
          One idea we tried, an automatic meter-counting fix pass, made results worse, so we
          dropped it.
        </li>
      </ul>
    </section>
  );
}
