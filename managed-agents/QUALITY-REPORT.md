# Quality report: sung diction and prosody (2026-10-12)

Measurement only. No prod prompt, pipeline or `apps/web/lib/agent/*` change. Harness: `scripts/quality/diction-sweep.ts`.

## Method
- 50 frozen lyrics: the first 10 briefs per language (hi, ta, te, kn, bn) from the PCE `fullB` batch (the shipped polish), section headers removed, first 8 lines (`scripts/quality/lyrics-fullB-n10.json`).
- One Lyria clip render each (`lyria-3-clip-preview`, ~30 s), prompt = fixed folk-pop style per language + `dictionHints(language)`.
- Gemini (`GEMINI_QA_MODEL`, default `gemini-3.8-flash`) transcribes the sung audio; `scoreTranscript` (production scorer) gives matchPct = 1 - mean line CER. A sample "fails" below 60.
- Spend: GBP 2.50 for the sweep plus GBP 0.90 for 18 re-renders kept as audio for reviewers (est. at 0.05/clip; the key was a shared test key, not a user envelope). 60 s class not run (see below).

## Results, 30 s clips, N=10 per language
| Language | N | Median | p10 | Mean | Failures |
|---|---|---|---|---|---|
| Bengali | 10 | 97 | 91 | 95 | 0 |
| Hindi | 10 | 99 | 96 | 95 | 0 |
| Kannada | 10 | 99 | 98 | 99 | 0 |
| Tamil | 10 | 98 | 93 | 96 | 0 |
| Telugu | 10 | 97 | 83 | 92 | 0 |

Raw per-sample rows: `managed-agents/quality/clip-30s.jsonl` (transcripts and flagged lines included). Reproduce the table with `npx tsx scripts/quality/diction-sweep.ts --report managed-agents/quality/clip-30s.jsonl` (no spend).

## Diagnosis
1. **Kannada diction is not the problem.** Highest and tightest of the five (median 99, p10 98; 10 further renders scored 94-100). Its weak evidence in EVAL-PCE is about *prosody*, which Gemini transcription cannot see. Only native listeners can settle it; packet below.
2. **Telugu is the weakest on this metric, but the low scores are tail truncation, not mispronunciation.** All 5 samples under 85 (te-11 68, te-16 66, te-14 84, te-17 83, plus hi-16 66, bn-14 81) have their *last 1-2 lines never sung*: the 30 s clip ran out. The flagged lines' "heard" text is a fragment of an earlier line. Telugu briefs produce long lines (te-11 lines run 45+ characters), so 8 lines do not fit. (6 of 50 samples overall show this; 5 of 5 under 85.)
   - Fix to test, eval-gated: cap clip lyrics by *character budget per language* (or 6 lines for Telugu) instead of a fixed line count; the prod low Telugu average (62.8, n=6) is likely the same effect. This is a pipeline/prompt change, so it belongs behind the eval gate, not a direct edit.
3. **Harness bug found and fixed while scoring:** `\b` never matches Indic scripts, so bare section words (పల్లవి, చరణం) leaked into the scored lyrics for te-16 (66 -> counted properly after fix). Worth checking whether the prod header-stripping has the same flaw; I did not touch `apps/web/lib/agent/*`.
4. **Caveat on the metric:** Gemini transcription is lenient (it can "hear" what it expects), so matchPct is an upper bound on intelligibility and says nothing about stress, meter or melody fit.

## Prosody: native-reviewer packet
`/mnt/project-files/quality/reviewer-packet/reviewer-sheet.csv` + audio in `/mnt/project-files/quality/review-audio/` (18 clips: 10 Kannada, 2 each other language, shuffled). Reviewers score 1-5 on stress/meter, word boundaries, vowel length, melody fit, overall singability, and name the worst line. Gate from EVAL-PCE: native kappa >= 0.4 and per-language lower CI >= 45% before any stronger public claim. Needs at least 2 Kannada native reviewers; two clips should be repeated blind to check intra-rater consistency.

## Not done / needs the lead
- **60 s class.** N=10 x 5 languages at 0.25 = GBP 12.50, over the ~GBP 8 shared cap (GBP 3.40 already used here). Proposal: N=3 per language (GBP 3.75) to size the effect, only if the lead agrees.
- **Eval-gated experiment** for the Telugu/Kannada length fix: designed above, not run (needs the prod eval tables; owned by the docs/PCE thread).
