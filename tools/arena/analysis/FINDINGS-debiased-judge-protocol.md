# Debiased audio-judge protocol (design, 2026-10-21, no spend yet)

**Problem.** Gemini holistic pairwise listens pick the first slot in both orders in most pairs (4 of 5 in the m2 set, 3 of 4 in E9-en), and the E9-en reasons named genres the clips were not (a "country performance" for the rock clip, "acoustic" for hip-hop). So the answer is mostly slot and prior, not audio.

**Protocol (`debiased_audio_judge.py`, three probes, each with its own check):**
1. **Genre probe (does it hear at all?).** One clip, no brief, closed genre list, k=3 samples. Scored against the known label. If it cannot name pop vs rock vs hip-hop vs R&B vs country on clips we generated, no preference from it means anything. This is also the genre-claim check: a judge's stated genre is compared with the brief's, never accepted from prose.
2. **Pointwise probe.** One clip, absolute 1-5 on fixed anchors (singing, production), k=3 at temperature 0.7, median. No second clip, so no slot to be biased toward. Scored by rank correlation with sung-word diction (the earlier pointwise check had rho +0.14 and only two values used; anchors that tell it to use the full range are the change under test).
3. **Pairwise probe.** k=4 repeats, slot order randomised after the first two (a,b then b,a); a verdict needs a clear majority for the same clip across both slots, otherwise `no_call`. Reports slot-A share, so bias is measured not hidden.

**Validation (offline first, then one small paid run).** Already in hand with no new renders: 9 English clips with known genre and diction (E9-en), 7 kn/hi clips (E8), and 5 m2 pairs with known diction gaps of 10 to 61 points (where the old judge agreed with diction 0 of 4 times). Pass bars set before the run: genre accuracy >= 7 of 9 majority-vote; pointwise rho with diction >= +0.5 on 16 clips; pairwise: slot-A share between 0.35 and 0.65 and, on decided pairs, no worse than chance against diction (a protocol that decides at all and agrees with diction on >= 3 of 4 would earn a trial in best-of-N as a tie-break only; diction stays the floor).

**Estimated cost.** About 95 Flash calls (27 genre + 48 pointwise single-clip + 20 pairwise), roughly USD 0.35 at the above-list price used in the arena, hard stop USD 0.6. Specs: `lab/render-harness/e9-en/spec_{genre,point,pair}.json`.
