# Unit economics (working model — replace estimates with measured `list_cost` / Lyria billing in week 1)

Unknowns that move everything: **actual Lyria price per clip/full** (ledger assumes £0.05 / £0.25; secondary sources suggest ~$0.08 for full). Measure from AI Studio billing and the per-job ledger.

Cost per job (INR, estimate): Lyria clip 4–5 · Lyria full 7–29 · Claude free-path ≈ 3–5 · Claude paid-path ≈ 8–15 (Sonnet coordinator + Haiku ×K + Opus polish) · embedder/Cloud Run ≈ 0.2 · Gemini diction/QA ≈ 1–2 · storage/bandwidth ≈ 0.3.
→ full paid song ≈ INR 17–46; clip ≈ INR 9–12.

Price points (value-led, India-first; GST 18% and ~3% gateway fee ⇒ INR 299 nets ≈ 245):
- Creator INR 299/mo (≈ $6.99 intl): 40 credits ≈ 8 full songs + clips. Worst case cost (all full @ INR 46) = 368 → margin guard: cap full renders/day and require ≥ 40% margin at 100% quota use, ≥ 70% at expected 30–40% use.
- Pro INR 799/mo (≈ $17.99 intl): 120 credits ≈ 20 full + clips, Opus polish, diction coach.
- Free: 6 credits (6 clips) ⇒ worst-case INR ≈ 60/user/mo; global daily circuit breaker.
- Credit packs INR 99 (12 credits).
Guard rails: per-user daily render cap · per-job token ceiling · blended-margin alert < 60% · India-vs-intl pricing by billing country with card-country check.
Stripe India caveat: Indian issuers may decline cross-border recurring cards (RBI e-mandate); validate with an Indian card in live mode; keep Razorpay UPI AutoPay as fallback.

## Decision log - tier envelopes (2026-10-12, advisor-checked)
Ledger unit cost: ~GBP 0.25 per full Lyria render, ~0.05 per clip; Claude+infra ~GBP 0.10 per paid song.
| Tier | Price (net of GST/fees) | Monthly Lyria envelope | Worst-case songs | Worst-case margin |
|---|---|---|---|---|
| Free | 0 | GBP 0.30 | 1 | n/a (acquisition cost) |
| Creator | INR 299 (~GBP 2.2) | GBP 0.75 | 3 full | ~50% |
| Pro | INR 799 (~GBP 5.8) | GBP 2.00 | 8 full | ~52% |
Envelopes are enforced atomically per user (`reserve_user_spend`) under the global monthly ceiling. If measured Lyria billing is lower than the ledger (secondary sources suggest ~USD 0.08 per full), raise songs-per-tier proportionally rather than cutting price. Marketing copy must say "up to N full songs a month", never "unlimited".
