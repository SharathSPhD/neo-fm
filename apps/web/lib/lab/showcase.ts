import raw from "./showcase-data.json";

/** Judge verdict for one case, from the Premium side: "premium" = Premium won, "standard" = Standard won. */
export type ShowcaseVerdict = "premium" | "standard" | "tie";
export interface ShowcaseJudge {
  winner: ShowcaseVerdict;
  /** Summed five-dimension score difference (Premium minus Standard); null when the judge output was unparseable. */
  diff: number | null;
  dims: Record<string, number> | null;
  unparsed: boolean;
}
export interface ShowcaseCase {
  id: string;
  lang: string;
  style: string;
  brief: string;
  standard: string;
  premium: string;
  judges: { claude: ShowcaseJudge; gemini: ShowcaseJudge };
}

export const SHOWCASE_LANGS: { code: string; name: string }[] = [
  { code: "kn", name: "Kannada" },
  { code: "hi", name: "Hindi" },
];

/** Off unless LYRIC_SHOWCASE_ENABLED=1; the /lab/showcase page 404s without it. */
export const showcaseEnabled = (env: Record<string, string | undefined> = process.env): boolean => env.LYRIC_SHOWCASE_ENABLED === "1";

export const showcaseCases = (): ShowcaseCase[] => (raw as { cases: ShowcaseCase[] }).cases;

export interface ShowcaseTally {
  premium: number;
  standard: number;
  tie: number;
}

/** Win/loss/tie counts per judge family. Judge families are reported separately, never pooled. */
export function tally(cases: ShowcaseCase[], judge: "claude" | "gemini"): ShowcaseTally {
  const t: ShowcaseTally = { premium: 0, standard: 0, tie: 0 };
  for (const c of cases) t[c.judges[judge].winner] += 1;
  return t;
}

/** Mean per-dimension score difference (Premium minus Standard), over cases the judge scored. */
export function meanDims(cases: ShowcaseCase[], judge: "claude" | "gemini"): Record<string, number> {
  const sum: Record<string, number> = {};
  let n = 0;
  for (const c of cases) {
    const d = c.judges[judge].dims;
    if (!d) continue;
    n += 1;
    for (const [k, v] of Object.entries(d)) sum[k] = (sum[k] ?? 0) + v;
  }
  return Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, n ? v / n : 0]));
}

/** Exact two-sided sign test on decisive cases (ties dropped). */
export function signP(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  const k = Math.min(wins, losses);
  let p = 0;
  let c = 1;
  for (let i = 0; i <= k; i++) {
    p += c;
    c = (c * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * p) / 2 ** n);
}
