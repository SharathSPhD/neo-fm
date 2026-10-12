# Experiment: clip lyric length budget (eval-gated, not applied)

**Problem** (see QUALITY-REPORT.md): in 6 of 50 30 s sweep songs Lyria never sang the last 1-2 lines (5 of the 5 songs under 85 matchPct). Telugu is worst because its lines are long.

**Code, off by default:** `apps/web/lib/diction/budget.ts` (`fitToClipBudget`, env `CLIP_SYLLABLE_BUDGET`; nothing in `lib/agent` calls it). Tests: `apps/web/tests/clip-budget.test.ts`. Offline simulation: `npx tsx scripts/quality/budget-sim.ts managed-agents/quality/clip-30s.jsonl` (no spend).

## Offline result: a static cap is a poor trade
Syllables = independent vowels + consonants minus virama joins. "Fixed" counts a truncated song only when the trimmed lyric is no longer than what Lyria actually sang (guaranteed to fit); "lines lost" is the cost on songs that were already sung in full (min 3 lines kept).

| Budget (syllables) | Truncated fixed | Full songs losing lines | Lines lost in those |
|---|---|---|---|
| 50 | 6/6 | 42/44 | 88 |
| 60 | 6/6 | 41/44 | 72 |
| 70 | 5/6 | 34/44 | 47 |
| 80 | 3/6 | 14/44 | 19 |
| 90 | 1/6 | 5/44 | 7 |
| 120 | 0/6 | 0/44 | 0 |

Clip pacing varies: Telugu songs were cut at 84-88 syllables while another Telugu song with 109 was sung whole, so no single budget separates them. Fixing all six costs trimming nearly every healthy song.

## Arms to test (blind pairwise, Claude and Gemini judges, plus matchPct and unsung-line rate)
- **A control**: current 8-line clip lyrics.
- **B cap 80**: `CLIP_SYLLABLE_BUDGET=80`; expected to fix about half of truncations and trim 14 of 44 healthy songs by 1-2 lines. Judge question: does the shorter song lose more than the missing last lines cost?
- **C adaptive**: no cap; after the existing diction QA, if the last line(s) were unsung, re-render once with the lyric trimmed to the sung lines. Costs one extra clip (GBP 0.05) on about 12% of songs; does not shorten songs that fit.

Recommendation: C over B (B pre-penalises healthy songs; A's loss is only ~12% of songs). Needs about GBP 1 to run on the 6 known-truncated briefs plus 14 fresh ones; waiting for the lead's spend answer before any render.
