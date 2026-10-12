# Handoff: quality evidence, review kit, help FAQ

State (2026-10-12): three draft PRs, all with CI green, none merged. No prod changes made by this area.

| PR | What | Merge notes |
|---|---|---|
| #27 | PCE blind-eval evidence on `/trust` and `/pricing`; numbers in `apps/web/lib/eval/pce-results.ts`, test checks them against `managed-agents/EVAL-PCE.md` | Wording was tightened per lead review (AI judges, Kannada caveat, Sonnet polishes and judges). |
| #46 | Native-speaker review kit: `/native-review/<token>`, `/api/native-review/*`, `/api/admin/review-kit` (seed/token/revoke/report) | Migration `0072_review_kit.sql` must be applied before use. Rate-limit line for `lib/rate-limit.ts` is in the PR thread, not applied. |
| #54 | `/help` rewrite, 15 questions, machine-translated hi/ta/te/kn/bn behind a notice | Translations are model-made; keep the notice until native review. |

## Run and verify locally
```sh
pnpm install --frozen-lockfile
pnpm -r --filter "./packages/*" build   # workspace packages must be built first
cd apps/web && pnpm typecheck && pnpm lint && pnpm test
pnpm dev                                 # then open /trust, /pricing, /help?lang=ta
```
Review kit needs a database: apply 0072, publish a few songs per language, then with the bearer secret:
`POST /api/admin/review-kit?action=seed&lang=kn`, `?action=token&lang=kn&alias=Reviewer A` (link shown once, expires in 14 days), `GET ?action=report`, `POST ?action=revoke&id=<uuid>`.
The kit page, seed query and ratings upsert have only been unit-tested, never run against a live database.

## Open risks
- `.gitignore` ignores `review/` and `docs/*`: that is why the kit lives under `native-review` and docs/screenshots needed `git add -f`.
- Public claims: cultural fit and everything else is judged by AI only until native ratings exist; do not strengthen the copy before then.
- Help translations (safety, ownership, refund answers especially) are unreviewed.
- `/trust` does not yet show the new diction numbers from `managed-agents/QUALITY-REPORT.md`.

## Next 3 steps
1. Merge #27, #54, then apply 0072 and merge #46; add the `native-review` rate-limit rule.
2. Seed 5 songs per language, mint reviewer links, collect ratings; compute native kappa against the go/no-go in `EVAL-PCE.md` (>= 0.4, per-language lower CI >= 45%).
3. Add the 30 s diction table to `/trust` (small sample, strict and order-insensitive scores, upper bound because Gemini transcription is lenient; 60 s pending), and have native reviewers check the help translations before removing the notice.
