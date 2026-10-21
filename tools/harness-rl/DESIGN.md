# Harness RL and taste tuning: design (2026-10-21)

"RL" here means tuning the harness's discrete choices (prompt variants, exemplar count and source, draft count K, pick rule, polish model, render parameters) from judge and listener rewards. No weights are trained; local-model tuning is closed (Gemma QLoRA, 0/40).

## 1. What the research says
- **Prompt evolution beats weight RL on small budgets.** GEPA (reflective prompt evolution, Pareto-kept candidates) beat GRPO by 6-10% on average with up to 35x fewer rollouts, and beat MIPROv2 ([arXiv 2507.19457](https://arxiv.org/pdf/2507.19457v1)). It reads trajectories and judge feedback in words, which suits us: our judges already write reasons.
- **Bandits fit the routing and per-user part.** LinUCB-style contextual bandits give sublinear regret for choosing among LLM options with no offline training ([AAAI 2026](https://ojs.aaai.org/index.php/AAAI/article/view/39672)); NeuralUCB/TS personalise generation from user feedback ([arXiv 2404.16115](https://arxiv.org/html/2404.16115v1)). I found no paper doing per-user discrete prompt choice, so treat that part as ours to validate.
- **Judge rewards get hacked.** Optimising against an LLM judge finds its blind spots ([arXiv 2507.08794](https://arxiv.org/html/2507.08794v1), [2607.05904](https://arxiv.org/pdf/2607.05904)). Our own lab showed it: the metre/rhyme score rose while judged diction did not. Mitigations we already own: two judge families, both orders, blind, a held-out brief set, and a final gate no optimiser sees.

## 2. What the data says about our budget (run `python3 replay.py`, free)
The 38 real refs-vs-production battles split by language: te 8.0/8, mr 5.0/7, kn 3.5/8, hi 2.5/7, ta 2.0/8. So the best arm differs by language, which is exactly the contextual-bandit setting (context = language, later language x style). `sim.py` shows the catch: with a 0.12 true gap and 80 judged calls, Thompson picks the true best arm only about 44% of the time and cuts regret just 18% against a fixed A/B. **Open-ended arm search on paid judge calls does not converge at our volume.** So:
1. Search over few arms (<=4 per language), seeded by what already worked, not wide prompt sweeps.
2. Use a cheap proxy reward for exploration and the paid two-family judge only to confirm (below).

## 3. Environments
| Env | State/context | Arms | Reward | Cost |
|---|---|---|---|---|
| **Replay (built)** | language, brief | any arm with logged battles | arena win/tie/loss vs champion | free |
| **Proxy env** | language, brief | lever settings (exemplars 0/3/6, playbook, K, romanize) | cheap judge: Haiku pairwise vs the cached champion output, both orders, plus deterministic guards (script purity, line count) | about USD 0.002 per pair |
| **Gate env** | held-out 40 briefs | the single promoted candidate | Claude + Gemini blind both orders; promotion rule +3/+2 wins, no dimension worse by 0.15 | about USD 0.75 per pair of variants |
| **Listener env (live)** | listener taste card, daypart, language | style family, exemplar set, playlist slot | finish, replay, share, like, skip (taste.ts weights) | free, thin |
Champions' outputs are cached per brief so each new arm costs one generation and one judge pair. The proxy judge must be validated first with `arena/validate.py` against the gate judges (agreement on the 138 judge-labelled pairs), otherwise it is just another gameable metric.

## 4. Embedding in the CMA
The CMA already routes jobs (language, tier, flags). Add a **policy table** (`harness_policy`: language x tier -> arm id + posterior counts), read at job start, replacing hand-set env flags like `PCE_HARNESS_REFS=te`.
- **Serve**: Thompson-sample among promoted arms only (champion plus at most one challenger at 10-20% traffic). Log arm id and brief hash in `job_telemetry`.
- **Learn offline**: a nightly job pulls (a) arena-style judge outcomes on pool songs, (b) listener finish/replay/skip per arm, and updates posteriors. Judge outcomes weigh 1.0, listener events 0.2 each until volume exists.
- **Promote**: only through the eval gate. A bandit may reallocate traffic between already-gated arms; it never invents a prod prompt. A GEPA-style proposer can write candidate prompts into a queue, but each still needs the gate.
- **Safety**: moderation, no voice cloning and the spend guards sit outside the policy; the policy cannot disable them. Kill switch is the existing flag (unset to fall back to the champion).

**Migration safety:** the read path must degrade gracefully. If `harness_policy` is missing or empty, the CMA uses today's env flags (`PCE_HARNESS_REFS`, etc.) unchanged, so code can merge before S applies the migration.

**Policy row shape** (language x tier -> arm): `{language, tier, arm_id, model, exemplars, playbook, drafts_k, challenger_arm, challenger_share, a, b}`. `model` lets the premium lyrics work (Opus/Sonnet tiers) be an arm like any other, judged and promoted through the same gate; tier is part of the context, so a Pro polish model never leaks to Free.

## 5. Online, user-specific tuning
Yes, feasible in two layers, and the app should ask for more than a prompt:
1. **Stated taste at onboarding (cold start).** A short form: languages, genres/eras, mood by daypart, favourite artists' *eras and forms* (not imitation), instruments (carnatic, hindustani, film, folk), themes and background (city, village, diaspora), lyric register (formal/colloquial). The per-song taste block stored by PR #462 (`document_json.metadata.taste`) is the input and the reward-attribution key: each listener event joins back to the taste fields and arm that made the song. Claude turns it into a taste card (extends `userCard` in `personalization/taste.ts`) and into prior pseudo-counts on style/arm posteriors. `sim.py`: a correct stated style lifts the first-30-song like rate 0.56 to 0.62; a wrong one costs 0.05 (0.51), so keep prior strength small (4 pseudo-counts) and let behaviour overwrite it.
2. **Behavioural posterior per listener.** Per-user Beta over style x lever, shrunk toward the language-level posterior, updated from finish/replay/skip/share and line edits. It moves in real time because it is a counter update. Choices it controls are cheap ones: style family, exemplar set, ordering, voice; it does not change safety-critical prompts.
Expect little signal at first (last user song job was 2026-10-19, 39 jobs total), so the stated-taste layer carries cold start and the language-level policy carries lyric quality.

## 6. Next steps (ordered)
1. Merge this prototype (free, off prod).
2. Validate a cheap proxy judge on the 138 labelled pairs (free replay of stored judgments, plus about USD 0.30 of Haiku if S taps).
3. Add `harness_policy` table + read path behind a flag (migration, needs S's apply); start with ta/mr/hi/kn challenger arms (romanize, refs6, native-script exemplars from the 400-song corpus) in the proxy env.
4. Taste-card onboarding form and prior wiring, tested with emulator scripts.
Any paid judging needs a tap card with the figure first.
