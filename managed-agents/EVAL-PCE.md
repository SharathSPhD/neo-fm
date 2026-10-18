# PCE lyric evaluation (offline, blind) — 2026-10-12

**Question:** does the PCE engine (K candidates, contrastive selection, agent-as-LM; Haiku poets) produce better *lyrics* than a strong plain-LLM baseline once both get the same Sonnet polish?

**Design.** 150 frozen briefs (30 each: Kannada, Tamil, Telugu, Hindi, Bengali). Both arms get the same structure target (30 s: ~8 short lines). PCE arm: a Claude Managed Agent runs the vendored pce engine (EmbeddingGemma embedder; a run counts only if it produced the engine's `cascade_audit.json` receipt), then Sonnet polish. Baseline: 6 Haiku drafts -> Sonnet picks the best and revises it. Judging is blind, both orders, five 1-5 dimensions (prosody, diction, imagery, cultural fit, originality); a pair is a win when the order-averaged total differs by >= 1.0 of 25. Judges: Claude Sonnet and, independently, Gemini (different model family).

| Batch | PCE wins | Baseline wins | Ties | Gemini: PCE / baseline |
|---|---|---|---|---|
| fullB: PCE + Sonnet polish vs best-of-6 + polish (n=149) | **87** | 41 | 21 | **87** / 50 |
| fullC: PCE + meter-lint-driven polish (n=149) | 73 | 57 | 19 | 69 / 52 |

- fullB mean dimension difference (PCE minus baseline): imagery +0.51, originality +0.62, cultural +0.32, diction -0.05, **prosody -0.24**. Claude and Gemini agree on 103 of 119 pairs both decided (87%).
- By language (Claude judge, PCE-baseline): Hindi 22-4, Tamil 18-8, Bengali 17-10, Telugu 16-12, Kannada 14-7. Gemini splits Kannada 13-15, so Kannada is the weakest evidence.
- **Negative result:** the deterministic akshara-count lint feeding a second "fix the meter" pass (fullC) made things *worse* (prosody -0.41, fewer PCE wins). It was reverted; the shipped polish is the fullB version.
- Earlier unconfounded checks: unpolished PCE vs best-of-6 lost 2-6, so the polish step is part of the product, not decoration.

**What this supports.** "In internal blind tests across five Indian languages, AI judges from two different model families preferred lyrics from our PCE pipeline over a strong single-model baseline in most comparisons (87 of 149 vs 41, Claude judge; 87 vs 50, Gemini judge); the gains were in imagery, originality and cultural fit."
**What it does not support.** Claims about singability or prosody (PCE is slightly behind there), about human songwriters, about audio, or about "best". No native-speaker panel has reviewed these yet (needed before any stronger claim; advisor go/no-go: native kappa >= 0.4, per-language lower CI >= 45%).

Reproduce: `/api/admin/pce-eval` actions start / advance / polishcopy / gjudge / report; data in tables `eval_runs`, `eval_judgments` (neo-fm-prod).

## Guarded self-improvement: first run (2026-10-12)
`/api/admin/self-improve` — Opus drafted a new polish template from the 8 worst-prosody training pairs (held-out briefs never shown). On the 28 held-out briefs it **lost** to the live template (candidate 11 PCE-wins vs live 20; worse on every dimension), so the verdict was `reject` and nothing changed. Promotion needs both Claude and Gemini to see a gain (>= +3 / +2 wins) with no dimension worse by > 0.15, and a daily monitor rolls a promoted version back if the pronunciation match drops > 10 points. The loop is data-only: it can change one prompt template, never code, safety rules, spend caps or the eval set.

## Running the prompt gate cheaply (2026-10-18)
Gate a polish template (for example the FIT THE CLIP candidate in `managed-agents/candidates/polish-tail-safe.md`) with stored drafts only: no agent sessions, no audio. Auth is the admin bearer; all calls are POST on `/api/admin/self-improve`.

1. `action=register` with body `{"template": "<file contents>"}` stores it as a `draft` (validated: placeholders, no URLs or safety text). Returns `config_id`.
2. `action=estimate&config=ID&set=held&n=12` returns the case count and expected Claude USD. It spends nothing. `set` is `held` (fullA held-out briefs, live verdict already stored in fullB), `occasion` (batch occA) or `both`.
3. `action=evaluate&config=ID&set=held&n=12&max_usd=2` runs the gate. It refuses when the estimate exceeds `max_usd` (default `EVAL_MAX_USD` or 2, cap 8), stops when metered spend reaches it, and a run that skipped or lost pairs cannot recommend. The report carries `estimate` and the metered `spend`; compare them and set `EVAL_RATES_JSON` if the assumed prices are off.
4. Verdict `recommend` needs Claude >= live + 3 wins, Gemini >= live + 2, no dimension worse than live by > 0.15, on the same briefs. `promote` still needs a human `approved_by`. Do not pass `auto=1` while the eval budget is tight.

Occasion songs (wedding, birthday, festival, farewell; 3 per language, `lib/eval/occasion-briefs.ts`) are seeded once: `POST /api/admin/pce-eval?action=start&batch=occA&set=occasion&baseline=best6`, then `GET ...?action=advance&batch=occA` until done. The seed costs one lyrics-only Haiku session plus one best-of-6 baseline per brief; after that, every candidate evaluation reuses those drafts.

Expected Claude spend (list-price assumption, see `lib/eval/cost.ts`): about USD 0.4 for 12 held-out briefs, about USD 1.2 for 12 held-out plus 15 occasion briefs (live template recomputed for the occasion ones), plus a one-off occasion seed of about USD 1.5. The total eval budget is about USD 16.
