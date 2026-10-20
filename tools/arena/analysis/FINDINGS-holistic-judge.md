# Is the Gemini holistic audio listen a valid selector? (arena check, 2026-10-20, no spend)

Reference signal: Gemini sung-word diction match (% of lyrics recovered). Judge under test: Gemini holistic listen.

**Pointwise, 14 full 60 s renders** (`managed-agents/quality`, `holistic_judge_check.py`):
| judge field | rho vs diction | 95% interval |
|---|---|---|
| overall | +0.14 | -0.36 to +0.60 |
| pronunciation | +0.42 | -0.11 to +0.82 |
| stress_rhythm | +0.20 | -0.31 to +0.64 |
| clarity | 0.00 | -0.26 to +0.27 |

The judge uses only two values (3 and 4) on every field, so it has almost no resolution. The render with 51% diction got pronunciation 4; the two at 83-84% got 3.

**Pairwise, render-harness slice 1b:** the judge picked the lower-diction render in 3 of 3 pairs, both orders. 0/3 agreement, 95% interval 0 to 56%: consistent with anything from "systematically opposed" to "coin flip".

**Reading:** the holistic listen is not shown to hear word errors, and is too coarse to rank renders on its own. It is not shown to be wrong either; n is too small. Do not use it alone for best-of-N; keep diction as a veto and floor (as the render harness already decided) and use the listen only as a tie-breaker until it is validated.

**To settle it:** 5 more pairs already exist with diction gaps of 10 points or more (`m2_pairs_to_judge.json`, files in `lab/m2`). Judging both orders is 10 Flash audio calls, a few cents; with the earlier 3 that makes 8 pairs. About 20 separated pairs would give a useful interval (an 80% agreement rate would then exclude a coin flip); those need new renders and are the render harness's E2 budget, not the arena's.
