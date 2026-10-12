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
