# Stress and rhythm: the weakness, and three prompt-level mitigations to test

Status: design only. Nothing here changes a production prompt; every mitigation goes through the eval gate in [EVAL-PCE.md](EVAL-PCE.md) before it ships. No render spend was used for this note.

## What we know
- **Diction is not the weak point.** Gemini transcription matches the intended words at a median of 98-99 in Hindi, Tamil, Kannada and Bengali, and the lower Telugu mean is mostly last lines a 30 s clip never reached ([QUALITY-REPORT.md](QUALITY-REPORT.md)). The offline fixtures in `apps/web/tests/diction-regression-te-ta.test.ts` freeze that behaviour for Telugu and Tamil.
- **Stress/rhythm is the lowest-scoring dimension in every language** on the blind AI-judge pass (14 sixty-second files, scale 1-5; Telugu 3.0, Hindi 3.5, the rest 3.3). The judge's "worst issue" is nearly always one of three things: vowels held unnaturally long on line endings or sustained notes, "mechanical" metric alignment (every syllable on a grid), and abrupt phrase transitions between lines. Raw rows: `managed-agents/quality/blind-judge-60s.json`.
- **Limits of that evidence.** One judge model family, N=14, a compressed 3-4 range, no native listener. It is a pointer to where to look, not a measured defect rate. The native-reviewer packet (18 clips, Kannada weighted) is the arbiter and has not been scored yet.

## Likely mechanism (hypothesis, untested)
The five languages are syllable-timed with short/long vowel contrast. The music model appears to impose an English-style stress-timed melody: it stretches the final vowel of a phrase to fill the bar and places syllables on an even grid regardless of vowel length. That reads as "robotic phrasing" and "unnatural elongation" to a listener, while the words themselves stay intelligible, which is why diction scores do not move.

## Three prompt-level mitigations to test later
All three are text changes to the Lyria style prompt (`dictionHints`) or to what the lyricist agent is told. Each is flag-gated and off by default.

1. **Sustain rule in the style prompt.** Append to the per-language hint: sing at natural speech rate, hold only the final vowel of a line, no melisma or pitch slides on non-final syllables, keep short vowels short. Targets the most repeated judge complaint (unnatural vowel elongation). Cheapest to try: one string.
2. **Syllable-timed rhythm instruction.** Add an explicit feel to the style prompt per language: one syllable per beat, long vowels two beats, geminates and conjuncts held slightly longer, a stated tempo range and the regional metre where known (for example a named tala family). Targets the "mechanical grid" complaint by telling the model the rhythm is syllable-timed, not stress-timed.
3. **Even line lengths from the lyricist.** Ask the poem engine to keep lines within a tight syllable range (the budget counter in `apps/web/lib/diction/budget.ts` already counts Indic syllables) and to pair line endings on matching vowel lengths, so phrases fit a bar without stretching. This is a lyric-side change and lives in `apps/web/lib/agent/*`, so it goes to the lead as a PR, not from this thread. It also interacts with the clip-budget experiment in [EXPERIMENT-CLIP-BUDGET.md](EXPERIMENT-CLIP-BUDGET.md).

## How to test (needs approval before any render)
- Same frozen lyrics (`scripts/quality/lyrics-fullB-n10.json`), arms: control, 1, 2, 3, and 1+2. Kannada first (weakest evidence, packet already built), then one language per remaining family.
- Measure: diction matchPct must not drop (guard rail, both scores), blind AI-judge stress/rhythm and overall as a cheap screen, then the native packet for any arm that wins the screen. Ship only if native kappa and the lower CI clear the EVAL-PCE gate.
- Rough cost at 30 s clips: 10 songs x 4 arms x GBP 0.05 is about GBP 2 for Kannada alone, plus about GBP 0.10 of judge calls. This is above this thread's remaining allowance, so it waits for S's explicit approval. Without it, the offline steps (writing the arms as flag-gated strings, extending the judge script to compare arms) cost nothing.

## Not claimed
No mitigation here is shown to work. The only measured fact is the judge's low stress/rhythm score; the mechanism and the three fixes are hypotheses until the native packet and an arm comparison say otherwise.
