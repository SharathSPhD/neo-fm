/**
 * Best-of-N render harness: render, score with pluggable scorers, stop early when good enough, otherwise render again
 * (within a hard render and spend budget) and keep the highest-scoring candidate.
 *
 * Measured basis (docs/handoff/song-render-harness.md): plain-lyric renders already average ~94% diction match, so N>1
 * only pays on the weak tail and on high-variance style prompts (duet, folk, qawwali: 26..98% for the same prompt).
 * Hence the adaptive loop: most songs stop after one render and cost nothing extra.
 *
 * Pure orchestration. Rendering, scoring and spend reservation are injected; the caller owns every paid call.
 */
export interface Scorer<C> {
  name: string;
  /** Share of the composite; weights are renormalised over the scorers that returned a number. */
  weight: number;
  /** Returns 0..100, or null when the scorer could not judge (it then drops out of the composite, never counts as 0). */
  score(candidate: C): Promise<number | null>;
  /** A score at or below this vetoes the candidate (e.g. wrong script, instrumental heard as sung). */
  vetoAtOrBelow?: number;
}

export interface Scored<C> {
  candidate: C;
  scores: Record<string, number | null>;
  composite: number | null;
  vetoed: boolean;
}

export interface BestOfOptions {
  /** Hard cap on renders, the first included. */
  maxRenders: number;
  /** Stop as soon as a non-vetoed candidate reaches this composite. */
  acceptAt: number;
  /** Cost of one render; the loop never starts a render that would push spend over maxSpend. */
  costPerRender: number;
  maxSpend: number;
}

export interface BestOfResult<C> {
  winner: Scored<C>;
  all: Scored<C>[];
  spend: number;
  stoppedBecause: "accepted" | "render-cap" | "budget" | "render-failed";
}

export function composite(scores: Record<string, number | null>, weights: Record<string, number>): number | null {
  let sum = 0;
  let w = 0;
  for (const [name, wt] of Object.entries(weights)) {
    const s = scores[name];
    if (typeof s === "number" && Number.isFinite(s) && wt > 0) { sum += s * wt; w += wt; }
  }
  return w > 0 ? sum / w : null;
}

export async function scoreCandidate<C>(candidate: C, scorers: Scorer<C>[]): Promise<Scored<C>> {
  const scores: Record<string, number | null> = {};
  // A scorer failure is a missing signal, not a failed song.
  await Promise.all(scorers.map(async (s) => {
    try { scores[s.name] = await s.score(candidate); } catch { scores[s.name] = null; }
  }));
  const weights = Object.fromEntries(scorers.map((s) => [s.name, s.weight]));
  const vetoed = scorers.some((s) => s.vetoAtOrBelow !== undefined && typeof scores[s.name] === "number" && (scores[s.name] as number) <= s.vetoAtOrBelow);
  return { candidate, scores, composite: composite(scores, weights), vetoed };
}

/** Highest composite among non-vetoed candidates; unscored candidates rank last; if all are vetoed, the best of them (a song beats no song). */
export function pickWinner<C>(all: Scored<C>[]): Scored<C> {
  const rank = (x: Scored<C>) => x.composite ?? -1;
  const live = all.filter((x) => !x.vetoed);
  return [...(live.length ? live : all)].sort((a, b) => rank(b) - rank(a))[0]!;
}

export async function renderBestOf<C>(
  render: (attempt: number) => Promise<C>,
  scorers: Scorer<C>[],
  opts: BestOfOptions,
): Promise<BestOfResult<C>> {
  const all: Scored<C>[] = [];
  let spend = 0;
  let stoppedBecause: BestOfResult<C>["stoppedBecause"] = "render-cap";
  for (let i = 0; i < Math.max(1, opts.maxRenders); i++) {
    // The first render is the song itself and is always made; only retries are budget-gated.
    if (i > 0 && spend + opts.costPerRender > opts.maxSpend) { stoppedBecause = "budget"; break; }
    let c: C;
    try { c = await render(i); } catch (e) {
      if (!all.length) throw e;
      stoppedBecause = "render-failed";
      break;
    }
    spend += opts.costPerRender;
    const scored = await scoreCandidate(c, scorers);
    all.push(scored);
    if (!scored.vetoed && scored.composite !== null && scored.composite >= opts.acceptAt) { stoppedBecause = "accepted"; break; }
  }
  return { winner: pickWinner(all), all, spend, stoppedBecause };
}
