import type { BestOfOptions } from "./best-of";

/**
 * RENDER_BEST_OF=1 turns on adaptive best-of-N for song renders (default off). It is cost-bearing, so it stays dark
 * until the arena shows a win (docs/handoff/song-render-harness.md). Diction is the veto and floor; the Gemini
 * holistic listen is not used to select (arena/analysis/FINDINGS-holistic-judge.md: not shown to hear word errors).
 */
export function bestOfEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.RENDER_BEST_OF === "1";
}

/** Stop at the diction gate's "pass" line (80); a retry only when the take is below it. At most RENDER_BEST_OF_MAX renders (default 2, hard cap 3). */
export function bestOfOptions(costPerRender: number, env: Readonly<Record<string, string | undefined>> = process.env): BestOfOptions {
  const n = Math.floor(Number(env.RENDER_BEST_OF_MAX ?? 2));
  const maxRenders = Math.min(Math.max(Number.isFinite(n) ? n : 2, 1), 3);
  return { maxRenders, acceptAt: 80, costPerRender, maxSpend: costPerRender * maxRenders };
}
