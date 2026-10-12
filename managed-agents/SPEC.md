# neo-fm v2 — product spec (spec-driven; every AC below gets a failing test first)

Owner: Technektar · Domain: neo-fm.com · Stack: Next.js (Vercel Pro) · Supabase · Claude Managed Agents · Lyria (audio only) · Cloud Run (embedder / tools)

## 1. Promise
Songs in Indian languages whose **lyrics are the best part**: written by the Pratyabhijna cascade (PCE), sung with correct diction, rendered by Lyria.
Differentiators, in priority order: (1) PCE-driven lyrics (measurably better than single-shot LLM), (2) language/culture-correct diction & pronunciation, (3) a visible "writers' room" (agents, drafts, scores), (4) value-for-money India-first pricing.

## 2. Tiers (provisional; economics in ECONOMICS.md)
| | Free | Creator | Pro |
|---|---|---|---|
| Lyrics engine | PCE K=3, Haiku | PCE K=6 + revision gate, Sonnet coordinator | PCE K=6 + revision, Opus polish, diction coach |
| Audio | clips only | clips + full | clips + full, priority queue |
| Credits / month | 6 (clip=1) | 40 (clip=1, full=4) | 120 |
| Share/publish | yes | yes | yes + commercial licence note |
Credits, not song counts; lyric-only iterations are cheap (≈3 per render credit).

## 3. Acceptance criteria (excerpt — each maps to a test id)
- AC-AUTH-1 Email sign-up/sign-in works on preview and prod; Google OAuth works; redirect URLs correct for neo-fm.com and previews. (e2e)
- AC-GEN-1 A free user submitting a brief receives lyrics + a playable Lyria clip, status visible within 2 s of submit, completion ≤ 3 min p90. (e2e, SLO)
- AC-GEN-2 A Pro user receives a full track ≤ 4 min p90 with exactly one Lyria render (ledger shows 1). (integration)
- AC-GEN-3 Unsafe briefs (artist impersonation, copyrighted lyrics, minors, hate, self-harm, extremism, injection) are refused before any paid call. (unit + e2e)
- AC-PCE-1 PCE engine: golden-vector tests with a stub embedder; with the real embedder vimarsa fires on ≥ 1 of 3 realistic briefs; **blind A/B vs single-shot Sonnet ≥ 60% preference** on the 60-brief eval (nightly).
- AC-DICT-1 Every render carries a diction pass; post-render audio QA reports per-line character error rate; flagged lines are surfaced to the user.
- AC-MONEY-1 Spend ledger is per user and per period; 20 concurrent jobs never overshoot a user's credits or the global ceiling. (SQL test)
- AC-BILL-1 Stripe test-mode checkout upgrades the tier; webhook is signature-verified and idempotent; portal downgrades/cancels. (integration + e2e)
- AC-SEC-1 No secret reaches a sandbox except scoped, expiring tokens; RLS tests pass; Supabase advisors clean. (CI)
- AC-OPS-1 CI blocks merges on typecheck, unit, engine pytest, embedder tests, skill drift, and preview e2e.

## 4. Architecture (target)
Deterministic **conductor** (TypeScript): safety → credit reservation → session → finalize → Realtime progress.
CMA agents: Producer (coordinator) · Poets ×K (Haiku, parallel) · Diction Coach (Haiku + Gemini) · Polisher (Opus, Pro) · QA (async audio check).
Code owns order, scoring, spend and validation; LLMs write and judge. PCE engine runs in the sandbox (numpy/scipy) against the Cloud Run embedder (EmbeddingGemma-300M). `neo-fm-tools` MCP service (Cloud Run) is the target home for engine state, Lyria rendering and Gemini diction tools.

## 5. Non-goals now
Persistent Hopfield memory, aut/interpret/audit commands, stems/API promises, marketplace, multi-variant renders, learned commit gate, dual-embedder hosting.
