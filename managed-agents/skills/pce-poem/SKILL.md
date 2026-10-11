---
name: pce-poem
description: Compose song lyrics or a poem with the Pratyabhijna cascade protocol (constraint anchoring, K-candidate generation, contrastive exclusion of cliches, aspect-conditioned selection, vimarsa aspect-shift gate and a shadow revision pass). Use for any lyric, verse, haiku, sonnet or short literary form.
---

# pce-poem - cloud port of the Pratyabhijna `pce-poem` workflow

Port of `SharathSPhD/pratyabhijna` -> `plugin/commands/poem.md` + `agents/poet.md` +
`skills/cascade-poetry`. The original calls an MCP `cascade` tool backed by a Python
engine (local LM, sentence embeddings, Dirichlet BMR). That engine cannot run in this
sandbox, so each operator is carried out here as an explicit, auditable step. See
`FIDELITY.md` in the repo for what is and is not equivalent. Never skip a step and never
return a poem produced by a single un-scored draw.

## Inputs
- `topic` - the brief, <= 30 words (distil longer briefs).
- `form` - e.g. haiku | sonnet | free | song sections (pallavi/anupallavi/charanam, mukhda/antara, verse/chorus...).
- `language` - write natively in the target script and idiom; do not translate from English.
- `must_avoid` - cliches to dodge (always add the genre's stock images: e.g. "moon/rain/heart" pairings the user did not ask for).
- `K` - candidate count (tier-dependent; default 3, pro 6) and `revise` (true/false).

## Engine mode (preferred when `EMBED_URL` and `EMBED_TOKEN` are given in the kickoff)
This skill ships the real Pratyabhijna engine (`run_cascade.py` + package `pce/`, Python 3.11, numpy/scipy are preinstalled).
Locate it once: `find / -name run_cascade.py -path '*pce*' 2>/dev/null | head -1`; call that directory `$ENGINE`.
You are the language model; the engine does every scoring step (apohana, ananda, jnana BMR, vimarsa gate, commit policy).
1. `mkdir -p /mnt/session/work/pce && cd` there. Write `brief.json`:
   `{"topic": <brief, <=30 words>, "constraint": <step-1 line>, "must_avoid": [...], "aspects": [2-4 short phrases], "K": <3 free | 6 pro>, "seed": 0}`
   (`aspects` as short natural phrases; the embedder is multilingual so English aspects are fine.)
2. `export EMBED_URL=... EMBED_TOKEN=...` (from the kickoff) and run `python3 $ENGINE/run_cascade.py /mnt/session/work/pce`.
3. Exit code 3 = it needs text: read `needs.json`. It lists `prompts` (one per candidate; each begins with its own small nudge).
   Write one complete candidate per prompt, in order, in the target language/script, into `generations.json` under the key named by `kind`
   (`{"draft": [...], "revision": [...]}`, keep earlier keys). Pro tier: delegate each candidate to PCE Poet in parallel. Re-run step 2.
4. Exit code 0 = `result.json`. `surface` is the committed lyric (`committed` = draft|revision; revision is only taken if vimarsa fired).
   Copy `surface` into `/mnt/session/outputs/lyrics.md` (sectioned for singing) and `result.json` to `/mnt/session/outputs/cascade_audit.json`.
Never edit the engine or its numbers. If `EMBED_URL` is absent or the service errors twice, say so in the audit and use the manual cascade below.

## Cascade (manual fallback)
1. **constraint** - write one line (<= 20 words) naming form, tone, language, singable meter. Pick 2-4 `aspects` (semantic axes the user implied; never invent ones they did not).
2. **iccha - K candidates.** Produce K candidate drafts that share the same brief and constraint and differ only by seed/angle (different opening image, different aspect emphasis). With a worker agent available, spawn one per candidate (self-contained brief, write to `/mnt/session/work/cand_<k>.md`). Do not tune the prompt per candidate.
3. **apohana - contrastive exclusion.** For each candidate score 0-1: closeness to the constraint minus its closeness to the nearest `must_avoid` exemplar. Min-max normalise across the K candidates so a cliche-heavy draft loses mass instead of tying.
4. **ananda - aesthetic coherence.** Score 0-1 each: coherence to the constraint, diversity (no repeated lines/rhyme words), form fidelity (syllable/meter/section structure actually met - count it), singability. Average.
5. **jnana - selection.** posterior_k proportional to `1 + 1.0*ananda_k + 1.0*apoha_k` (+ `0.5` per `aspect` the candidate realises when aspects were given). Pick argmax; record the table in `/mnt/session/outputs/cascade_audit.json` (scores per candidate, selected index).
6. **vimarsa - aspect-shift gate.** Fire (event = true) iff ALL: novelty vs. the median of the other candidates >= 0.30, >= 1 aspect realised, ananda >= 0.40, and the draft's score gain over the median >= 0.05. Record `vimarsa_event` and one sentence on which aspects fired.
7. **kriya - enactment + shadow revision.** `revise=false`: emit the selected draft verbatim. `revise=true`: always write a revision from the vimarsa brief (keep what fired, remove the nearest must-avoid, fix failed form checks), then commit the revision iff vimarsa fired, else commit the draft. Record `committed: draft|revision`.

## Output
Write `/mnt/session/outputs/lyrics.md` (the committed surface only, sectioned for singing) and `cascade_audit.json`. Return only the lyrics plus, if vimarsa fired, one italic line naming the aspects.

## Anti-patterns
- Do not return a lyric that has not passed steps 3-6.
- Do not pad lyrics with translation or commentary; no markdown inside lyric lines.
- Do not use a hardcoded cliche list as the only `must_avoid`; derive it from the brief.
