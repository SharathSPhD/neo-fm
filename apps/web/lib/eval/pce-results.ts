/**
 * Single source of truth for the public PCE quality evidence shown on /trust
 * and /pricing. Numbers are copied from managed-agents/EVAL-PCE.md (batch
 * "fullB"); tests/pce-results.test.ts fails if the two drift apart.
 */
export interface LanguageResult {
  language: string;
  pceWins: number;
  baselineWins: number;
}

export const PCE_EVAL = {
  briefs: 150,
  /** Pairs scored after dropping one failed run (EVAL-PCE.md: n=149). */
  pairs: 149,
  judges: { claude: { pce: 87, baseline: 41 }, gemini: { pce: 87, baseline: 50 } },
  ties: 21,
  /** Mean per-dimension score difference, PCE minus baseline (1-5 scale). */
  dimensions: [
    { label: "Originality", diff: 0.62 },
    { label: "Imagery", diff: 0.51 },
    { label: "Cultural fit", diff: 0.32 },
    { label: "Diction", diff: -0.05 },
    { label: "Prosody", diff: -0.24 },
  ],
  /** Claude-judge wins by language, strongest first. */
  byLanguage: [
    { language: "Hindi", pceWins: 22, baselineWins: 4 },
    { language: "Tamil", pceWins: 18, baselineWins: 8 },
    { language: "Bengali", pceWins: 17, baselineWins: 10 },
    { language: "Telugu", pceWins: 16, baselineWins: 12 },
    { language: "Kannada", pceWins: 14, baselineWins: 7 },
  ] satisfies readonly LanguageResult[],
  /** Gemini split for Kannada; the only language where the two judges disagree on the lead. */
  kannadaGemini: { pce: 13, baseline: 15 },
} as const;
