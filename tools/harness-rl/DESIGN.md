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

**Focus languages (S, 2026-10-21): Kannada and Hindi first, others added over time.** Both are where production is already strong (refs vs production: kn 3.5/8, hi 2.5/7; the formal Hindi gate failed on a ceiling effect), so the first policy rows are kn and hi, each with the champion plus one challenger, and the search spends its judged calls there. Candidate challengers: native-script exemplars from the 400-song corpus used at the Haiku draft step, Claude romanization (live for kn), and a stronger polish model for the premium tier. Because a ceiling hides differences, compare challengers on hard briefs (named people, occasions, folk forms) rather than the average brief.

## 3. Environments
| Env | State/context | Arms | Reward | Cost |
|---|---|---|---|---|
| **Replay (built)** | language, brief | any arm with logged battles | arena win/tie/loss vs champion | free |
| **Proxy env** | language, brief | lever settings (exemplars 0/3/6, playbook, K, romanize) | cheap judge: Haiku pairwise vs the cached champion output, both orders, plus deterministic guards (script purity, line count) | about USD 0.002 per pair |
| **Gate env** | held-out 40 briefs | the single promoted candidate | Claude + Gemini blind both orders; promotion rule +3/+2 wins, no dimension worse by 0.15 | about USD 0.75 per pair of variants |
| **Listener env (live)** | listener taste card, daypart, language | style family, exemplar set, playlist slot | finish, replay, share, like, skip (taste.ts weights) | free, thin |
Champions' outputs are cached per brief so each new arm costs one generation and one judge pair. The proxy judge must be validated first with `arena/validate.py` against the gate judges (agreement on the 138 judge-labelled pairs), otherwise it is just another gameable metric.

**Proxy judge result (2026-10-21):** Haiku pairwise, both orders, on 40 of the 138 labelled pairs: 24 agree with the Claude+Gemini panel, 14 tie, 2 disagree (92% agreement excluding ties; est. USD 0.09). It never contradicts the panel, but 35% ties means it is a coarse filter: use it to drop clear losers, not to rank close arms. It needed a 2500-token cap (#471) because Haiku's thinking uses the budget.

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

## Offline policy replay (2026-10-21, no spend)

`apps/web/lib/harness-policy/simulate.ts` runs the real `pickArm` over N jobs and feeds it rewards bootstrapped from recorded judge scores (`tools/arena/data/battles.jsonl`: 38 harness-refs vs prod battles, 5-8 per language, plus synthetic reward pools). `tests/harness-policy-replay.test.ts` pins the properties below.

| Check | Result |
|---|---|
| Challenger traffic cap | With refs rewarded 0.95 vs 0.5, refs share stays at or under max_share (0.15) + noise. Replaying the recorded battles per language (3000 jobs, challenger role): kn 0.07, hi 0.05, te 0.13, ta 0.03, mr 0.10. The cap holds even when a challenger looks perfect (te mean reward 1.00 on n=8 still gets 0.13). |
| Convergence (two champions) | True 0.7 vs 0.4: late-run share 0.8, converged within 600 jobs. True 0.8 vs 0.5: late share 0.77 by job 199. True 0.65 vs 0.5: 0.63, converged only around job 3000. True 0.55 vs 0.5: indistinguishable (0.55, never converges). Thompson keeps exploring, so expect "mostly the better arm", not winner-take-all, at binary-reward noise. |
| Equal arms | No runaway: shares stay near 0.5. |
| Fallback | Policy off: every job returns the flag arm (source flags). Policy on but no rows for the language: same. No database is touched in either case. |
| Recorded battles | kn and hi refs means are 0.44 and 0.36 (n=8, 7), below 0.5, so the policy would give them under 8% of traffic and would not promote them; te 1.00 (n=8) and mr 0.71 are promising but each is 7-8 battles, far too thin to promote without the eval gate. This matches the earlier gate results. |

Takeaway: at about 7 battles per language the recorded data cannot support a promotion on its own. The policy's job at launch volume is to hold challengers at a capped share and collect listener rewards; promotion still goes through the eval gate.

### Taste prior shared with STATION_TASTE

`lib/harness-policy/taste.ts` reads the same `normaliseTaste` profile (`taste_profiles.stated`, saved via #487) and turns it into a per-arm nudge: form-heavy genres (ghazal, carnatic, hindustani, sufi, devotional, bhavageete, rabindrasangeet, folk) or a formal register lean on corpus refs (+0.025 per signal, cap 0.05); a purely Western profile leans on `live` (+0.02). It is added to the Thompson draw, only for listeners with the personalize consent, and halves every 10 of the listener's own settled observations of that arm. Tests show a cold-start tilt toward refs and that 30 songs of the listener's own results overrule it (refs picked under 10%). The prior is a guess about taste, not evidence, so it is deliberately smaller than one posterior standard deviation at n=40.
