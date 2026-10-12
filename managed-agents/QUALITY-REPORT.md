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

## Results, 60 s songs, N=3 per language (2026-10-12, GBP 3.75)
Same method, `lyria-3.5` with "exactly 60 seconds". **Correction to an earlier draft of this section:** the run was meant to use the full PCE lyrics plus a repeated hook, but a script bug (the `--lyrics` flag was only honoured by the `--report` path) made it render and score the same trimmed 5-6 line lyrics as the 30 s sweep (fixed in `diction-sweep.ts`). So this measures "30 s-sized lyrics asked to fill 60 s", not songs with 60 s-sized lyrics; `lyrics-fullB-60s-n3.json` is prepared for a proper re-run (about GBP 3.75, not yet approved). N=3: a smoke test, not a distribution.

| Language | N | Median (in order) | Median (order-free) | In-order scores | Order-free scores |
|---|---|---|---|---|---|
| Bengali | 3 | 96 | 96 | 100, 96, 84 | 100, 96, 84 |
| Hindi | 3 | 96 | 96 | 95, 96, 97 | 95, 96, 97 |
| Kannada | 3 | 100 | 100 | 100, 100, 83 | 100, 100, 95 |
| Tamil | 3 | 94 | 94 | 94, 94, 51 | 94, 94, 88 |
| Telugu | 3 | 97 | 97 | 97, 96, 97 | 97, 96, 97 |

- **Length control works:** 15 of 15 files are 60.6-67.1 s (ffprobe).
- **Two low in-order scores are section reordering, not diction:** Tamil ta-1 scores 51 in order but 88 order-free; Kannada kn-11 scores 83 in order but 95 order-free (Lyria sang the sections in a different order than written). The in-order scorer reads that as failure. `scoreTranscriptUnordered` (below) fixes the reporting.
- Bengali bn-11 (84) is a real small deviation (several words heard differently), unchanged by order-free scoring.

## Diagnosis
1. **Kannada diction is not the problem.** Highest and tightest of the five (median 99, p10 98; 10 further renders scored 94-100). Its weak evidence in EVAL-PCE is about *prosody*, which Gemini transcription cannot see. Only native listeners can settle it; packet below.
2. **Telugu is the weakest on this metric, but the low scores are tail truncation, not mispronunciation.** All 5 samples under 85 (te-11 68, hi-16 66, bn-14 81, te-17 83, te-14 84; 3 of them Telugu) have their *last 1-2 lines never sung*: the 30 s clip ran out, and the "heard" text of the flagged lines is a fragment of an earlier line. Telugu briefs produce long lines (te-11 lines run 45+ characters), so 8 lines do not fit. 6 of 50 samples show this tail loss overall.
   - Fix to test, eval-gated: cap clip lyrics by *character budget per language* (or 6 lines for Telugu) instead of a fixed line count; the prod low Telugu average (62.8, n=6) is likely the same effect. This is a pipeline/prompt change, so it belongs behind the eval gate, not a direct edit.
3. **Harness bug found and fixed while scoring:** `\b` never matches Indic scripts, so bare section words (పల్లవి, చరణం) leaked into the scored lyrics for te-16 (te-16 went from 66 to above 90 once rescored; it is not a real failure, and Telugu p10 moved 68 -> 83). Worth checking whether the prod header-stripping has the same flaw; I did not touch `apps/web/lib/agent/*`.
4. **Caveat on the metric:** Gemini transcription is lenient (it can "hear" what it expects), so matchPct is an upper bound on intelligibility and says nothing about stress, meter or melody fit.

## Prosody: native-reviewer packet
`/mnt/project-files/quality/reviewer-packet/reviewer-sheet.csv` + audio in `/mnt/project-files/quality/review-audio/` (18 clips: 10 Kannada, 2 each other language, shuffled). Reviewers score 1-5 on stress/meter, word boundaries, vowel length, melody fit, overall singability, and name the worst line. Gate from EVAL-PCE: native kappa >= 0.4 and per-language lower CI >= 45% before any stronger public claim. Needs at least 2 Kannada native reviewers; two clips should be repeated blind to check intra-rater consistency.

## Not done / needs the lead
- **60 s class at N=10** (GBP 12.50) was not affordable; N=3 per language was run after S approved (see above). Total thread render spend: about GBP 7.45 of the GBP 10 cap; a re-run with full-length lyrics would need about GBP 3.75 more.
- **Eval-gated experiment** for the Telugu/Kannada length fix: designed above, not run (needs the prod eval tables; owned by the docs/PCE thread).

## Methodology, for citation (trust page)
**What "diction match" is.** For each song, Lyria renders the lyrics; Gemini (`gemini-3.8-flash`, audio understanding) transcribes what is actually sung, in the original script, without being shown the intended lyrics; we compare that transcript to the intended lyrics line by line using character error rate (CER) over normalised Unicode code points (case, spaces and punctuation ignored). Match % = (1 - mean line CER) x 100. Each intended line is aligned to the best-matching window of the transcript, so the singer merging or splitting lines is not penalised. Section tags are excluded.

**Sample.** 50 songs: 10 per language (Hindi, Tamil, Telugu, Kannada, Bengali), 30 s clips, lyrics from the PCE engine's shipped pipeline on the first 10 evaluation briefs per language (first 8 lines, section headers removed). One render per lyric; no cherry-picking or re-rolls. Reported as median and 10th percentile because the distribution has a low tail; "failure" means match under 60 % (none at 30 s; one reordered 60 s song scored under 60 in order only, see above).

**What it supports.** "In an internal test of 50 AI-generated songs, an independent speech-recognition model transcribed 92-99 % of the intended characters correctly (mean per language, 30 s clips)." Per-language means: Kannada 99, Tamil 96, Hindi 95, Bengali 95, Telugu 92; medians 97-99.
**What it does not support.** Claims about singing quality, pronunciation naturalness, meter or musicality: the transcriber is lenient and can recover words from context, so this is an upper bound on intelligibility, and no native-speaker panel has reviewed prosody yet (packet ready, see above). Not a claim about songs with 60 s-sized lyrics (the 60 s run reused short lyrics, N=3 per language), other styles or voices, or songs a user edits. Telugu's lower mean is mostly songs whose last lines the 30 s clip never reached, not mispronounced words.

**Synced-lyric timing method.** For a finished song, Gemini returns timed sung segments (start seconds per line); each lyric line is aligned to that timed transcript by the same CER window matching; lines never sung are marked and interpolated. Checked by re-transcribing the audio cut at each line's times: 31 lines, mean CER 0.08. Resolution about 1 s (line-level, not word-level). Details in `LINE-TIMINGS.md`.

**Reproduce.** `npx tsx scripts/quality/diction-sweep.ts --report managed-agents/quality/clip-30s.jsonl` (free, from stored transcripts); re-rendering costs about GBP 0.05 per clip. Raw per-song rows including transcripts: `managed-agents/quality/clip-30s.jsonl`. Model versions: Lyria `lyria-3-clip-preview`, QA `gemini-3.8-flash`, run on 2026-10-12.

## Order-insensitive scoring (added)
`scoreTranscriptUnordered` / `scoreBoth` in `apps/web/lib/diction/index.ts` (tests: `apps/web/tests/diction-unordered.test.ts`): each intended line takes its best window anywhere in the transcript, but a stretch of transcript can vouch for only one line (greedy by lowest CER, at most 30 % overlap), so one sung hook cannot score a hook that appears twice; unsung lines count as fully wrong. Report both going forward: in order is what production stores today; order-free separates "sang it in another order" from "did not sing it". On the 50 stored 30 s songs the medians are identical (no reordering there); the 60 s smoke test shows the difference above. `diction-sweep.ts --report` prints both columns. Production (`lib/agent/*`) still stores only the in-order score; storing both is the lead's change.
