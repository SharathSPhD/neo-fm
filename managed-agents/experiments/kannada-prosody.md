# Experiment: prosody (Kannada first), offline

Status: proposal plus flagged code. Nothing here changes a prod prompt, `livePolishTemplate`, config, or Lyria spend.

## Why this dimension, this language
`managed-agents/EVAL-PCE.md` (fullB): PCE+polish leads on imagery, originality and cultural fit but is behind on **prosody (-0.24)**. Kannada has the weakest evidence (Claude judge 14-7, Gemini 13-15). The two prior attempts were negative: the deterministic akshara-lint second pass (fullC) made prosody worse (-0.41), and the self-improve candidate lost 11-20 on 28 held-out briefs. So the next attempt should change *how the editor is told to think about meter*, not add another pass.

## Variants (`apps/web/lib/lyrics/prosody-experiments.ts`)
Control is `DEFAULT_POLISH_TEMPLATE` (the fullB template). Each variant is a polish template only, same placeholders, same "output only lyrics" contract, and passes `validatePolishTemplate`.

| id | Hypothesis |
|---|---|
| `kn-laghu-guru` | Counting matras (laghu/guru) and naming line-end/prasa conventions equalises pairs in the unit actually sung, which raw syllable counts missed. |
| `anchor-pair` | Fixing line one of each pair and editing only line two repairs mismatches without the imagery loss of broader rewrites. |
| `sing-it-check` | Changing only lines that fall off the beat (others byte-identical) avoids over-editing lines that already scan. |

## How to run (no Lyria, existing harness)
Reuse the finished PCE arms of batch fullB; only the Sonnet polish call is repeated.
1. `GET /api/admin/pce-eval?action=polishcopy&batch=fullB&to=exp-<id>&variant=<id>&offset=0&n=30` per variant (the `variant` param is new and only affects the copied PCE arm in the target eval batch).
2. Judge exactly as fullB: Claude blind judge both orders, then `action=gjudge` (Gemini).
3. `action=report`, compare against control per language.

Cost per variant at n=30 Kannada-first: 30 Sonnet polish calls plus the usual judge calls. Start with Kannada only (30 briefs), expand to the other four languages only if a variant clears the bar.

## Decision rule (pre-registered, copied from the self-improve gate)
A variant is a candidate only if **both** judge families show a gain (>= +3 wins Claude, >= +2 Gemini over the control polish on the same briefs), no dimension is worse by > 0.15, and prosody specifically improves. Anything else is recorded as a negative result in EVAL-PCE.md, as with fullC. A winner is then proposed to S through the existing promotion path; this PR does not promote anything.

## Limits
n=30 per language is small; AI judges only; no native-speaker panel (still the precondition for any public prosody claim). Results from this experiment must not be used in marketing copy.
