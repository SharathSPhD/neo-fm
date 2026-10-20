# Song rendering harness (Lyria + Gemini + audio scorers)

Direction (S, 2026-10-20): song quality comes from a harness around the Lyria and Gemini APIs, not from training an open lyric model. Lyria is closed, so there is no policy to train; AI feedback is used to **choose** among renders and prompts. Model split: Claude writes lyrics, Gemini makes and judges music (Lyria Flash preferred, no Veo).

## What the existing data says (no new spend)

Source: `managed-agents/quality` and `lab/m2`, 98 Gemini-scored renders.

| Set | Renders | Mean diction match | Below 80 | Below 60 |
|---|---|---|---|---|
| 30 s clips | 50 | 94.7 | 3 | 0 |
| 60 s full | 15 | 92.0 | 1 | 1 |
| 60 s full lyrics | 15 | 90.7 | 1 | 1 |
| review renders | 18 | 97.9 | 0 | 0 |
| Hindi style profiles (m2, 2 renders per profile) | 13 | 69.4 | 5 | 2 |

1. **Plain-lyric songs rarely need a retry.** Resampling the pooled diction scores: best-of-1 averages 94.3 with 5% under 80; best-of-2 averages 98.0 with 0.3% under 80. The ceiling for diction-only selection is about +4 points on average, almost all from the 5% tail. So the loop must be adaptive (stop after one render when good), not a flat N.
2. **Style-heavy prompts are where variance lives.** Same lyrics and profile, two renders: duet 26 vs 90, ballad 65 vs 98, bhajan 65 vs 84, folk 83 vs 58. This is where best-of-N and prompt search can move quality.
3. **Diction is only one axis.** The blind Gemini listen rates most renders 3 to 4 out of 5 on stress/rhythm and "slightly mechanical vowel sustain". Selection has to include audio quality and naturalness, not just sung-word accuracy.
4. A single Gemini listen is a noisy classifier (disagreed with itself on 12 of 27 instrumental files). Selection scorers need at least two independent signals, and evaluation must use a **different** judge than the one that selected.

## Harness design

`apps/web/lib/render/best-of.ts` (this PR, unwired): `renderBestOf(render, scorers, {maxRenders, acceptAt, costPerRender, maxSpend})`.

- Render once. Score with pluggable scorers (weights renormalise over the ones that answer; a failing scorer drops out, never counts as zero).
- If a non-vetoed candidate reaches `acceptAt`, stop (most songs). Otherwise re-render up to `maxRenders`, never past `maxSpend`. Keep the highest composite; a vetoed candidate (wrong script, sung when instrumental, diction rerender verdict) loses to any non-vetoed one.
- Scorers, cheapest first: (a) diction gate verdict (`lib/diction/gate.ts`, already runs post-render); (b) Gemini audio listen for naturalness and lead-voice match (`lib/voice/check.ts` style); (c) offline-only: Whisper CER, Audiobox aesthetics, CLAP, and the Music Arena preference head from the audio-scoring thread. Offline scorers decide **weights and thresholds** in the lab; the product path can only call what runs on Vercel (Gemini).
- Prompt side: Claude writes N music-prompt variants per brief from the style catalog (`strategy/indian-music-styles.json`) and the corpus; the same harness picks among them. This is the "prompt optimiser", evaluated against the unmodified prompt.
- Tie-in to the raga thread: `PCE_RAGA_PROMPT` becomes one prompt arm in E3 instead of a separate gate.

## Experiments

| # | Question | Spend | Judge (held out from selection) |
|---|---|---|---|
| E0 | How much variance exists? | none, done above | n/a |
| E1 | Which local scorers agree with the Gemini listen on the 179 scored pool songs? Pick weights. | none (5090/Spark) | Gemini diction and blind-judge fields already stored |
| E2 | Does best-of-N (N=4, oracle and adaptive) beat one render on style-heavy briefs? | Lyria renders | blind pairwise Gemini Pro audio judge, both orders, plus local preference head |
| E3 | Do Claude-written prompt variants (style catalog, raga, voice cues) beat the stock prompt at equal render count? | Lyria renders | same |
| E4 | Which scorer subset gives the best pick per pound? | none (re-analysis of E2/E3) | same |

Decision rule: ship adaptive best-of-N behind a flag only if it wins at least 60% blind pairwise against single-render on the style-heavy set, at under 1.3 renders per song on average, and diction on the plain set does not drop. Claims stay "AI-judged" (AGENTS.md rule 4).

## Spend (log in `ops/lyria-cost.md`)

Render estimate GBP 0.25 (runs about 2x low). E2 first slice: 5 style-heavy briefs x 4 renders = 20 renders, about GBP 5, plus about GBP 1 of Gemini listens. Gemini balance is GBP 16 with a GBP 5 floor for listeners, so a 2x undercount still fits. Hard stop at 20 renders or GBP 6 estimated.

## Results so far (2026-10-20)

**E1, local scorers on 178 pool songs** ([audio-scorers-pool-2026-10-20.md](/mnt/project-files/audio-scorers-pool-2026-10-20.md)): the open scorers do not separate good from bad renders. Audiobox PQ is 7.9-8.2 in every language; the Music Arena preference head is 61.5% held-out (59% on vocals) and flat across the pool; CLAP text match is about 0 on native-script tags (needs English style descriptions); the sung-word check had no reference lyrics, so it is language match only; Malayalam is unmeasured (Whisper script share 0.11). Decision: `DEFAULT_WEIGHTS` in `lib/render/scorers.ts` gives Gemini-heard diction 0.55 and a Gemini naturalness listen 0.30, with PQ 0.10 and the preference head 0.05 as tie-breakers only.

**E2 slice 1, same input rendered twice** (prod `/api/admin/test-render`, Hindi brief occ-hi-1, 6 renders, about GBP 1.50 estimated): diction match duet 98/93, qawwali 85/100, bhajan 76/100. Picking the better of two beats the average single render by +2.5, +7.5 and +12 (mean +7.3, 3 pairs only). Folk and ballad prompts were refused by the safety screen on their wording (not billed) and are still to run.

**Next:** a Gemini naturalness listen scorer, a blind Gemini Pro pairwise judge for E2/E3, then wiring `renderBestOf` into the render step behind a flag once E2 shows the win-rate in the decision rule.

**E2 slice 1b, holistic judge (Gemini flash audio, both orders, 3 pairs):** the judge picked the same render in both orders for every pair, and it was the one with the LOWER diction match each time (duet 93 over 98, qawwali 85 over 100, bhajan 76 over 100). Gemini Pro hit its 250/day Tier 1 cap after the first duet call (same preference there). Reading: sung-word match and overall preference are different axes, so a diction-only pick can choose the render a holistic listener likes less, and diction should be a veto/floor plus a weight, not the whole score. Caveats: 3 pairs, a flash-family judge, and a judge that may not hear word errors well. The folk and ballad prompts were refused by the safety screen again on a plain-worded retry (not billed), so those two styles are untested.
