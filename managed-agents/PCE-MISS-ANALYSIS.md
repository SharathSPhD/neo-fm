# Why do Bengali and Hindi score lowest? (text-only analysis)

Scope: the 65 scored songs (13 per language, 30 s clips, order-free CER, 377 lines). Per-line features are in
`quality/line-features.json`. No Lyria spend.

## Findings

- **Bengali and Hindi are not the lowest at 30 s.** Telugu has the lowest mean (92). "Lowest" came from single songs at small N
  (bn-10 scored 37 in the 60 s run).
- **11 of 377 lines were missed** (order-free CER > 0.35). 10 of the 11 were never sung (CER = 1) and sit in the **last one or two
  lines**. Miss rate is 7.7% in the last two lines against 0.4% everywhere else. The exceptions are bn-10's skipped mid-song line
  and bn-18 (CER 0.47).
- **Misses by language:** Bengali 4, Telugu 4, Hindi 2, Kannada 1, Tamil 0.
- **Line length, conjuncts and guru density do not predict misses.** Correlation of line CER with akshara count -0.04,
  conjunct density 0.03, guru density 0.10 (n = 11, weak).
- **Song length does.** Songs with a missed line carried about 10% more aksharas (89 vs 81) and 5.5 vs 5.1 lines. The model
  runs out of 30 s and drops the tail; Bengali and Hindi drafts run a little longer, so they lose the tail more often.

So the cause is a length budget, not hard phonetics: the clip cannot hold the whole lyric.

## Proposed tweak (candidate, NOT live)

`managed-agents/candidates/polish-tail-safe.md`: the default polish template plus a "FIT THE CLIP" rule. A 30 s clip carries about
80 aksharas, so keep the lyric within about 85, put the strongest images first, and let the last line repeat the opening hook,
so a dropped tail costs little. Section tags are kept.

## Eval gate status

- `scripts/quality/polish-ab.mts` polishes the same stored lyric with the default and the candidate, then reports deterministic
  metrics (lines, aksharas, last-line repeat) and a blind pairwise judge (Claude and Gemini, randomised position).
- **I could not run it.** `MA_ANTHROPIC_API_KEY` in this environment returns 401 (invalid x-api-key) on every call. No result
  is claimed. I did not look for other credentials.
- The change is **not** eligible to go live from this PR. It needs the prod gate (`/api/admin/self-improve` or
  `pce-eval`, EVAL-PCE.md), run by the lead, plus a diction read on a few rendered clips if the lead approves spend.

## Caveats

N is small (11 misses). The A/B polishes already-polished lyrics with minimal edits, so it can only show the length effect on
text, not whether the tail is then sung.
