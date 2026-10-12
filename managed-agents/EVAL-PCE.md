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
