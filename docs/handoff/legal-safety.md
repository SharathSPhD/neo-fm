# Handoff: spend monitor, reports, rights safety, legal pages

## State
- Merged: daily Lyria spend-leak monitor (#21), abuse report queue and takedown (#35, migration 0069), multilingual rights screening and verbatim-overlap check (#65).
- Open: #76, terms, privacy (DPDP), content policy, AI ownership, lawyer review pack. CI green. Its copy mentions funnel counts, collections and dedications, so land it with or after those PRs.
- Nothing here was run against production. The test-user cleanup script has never been run on prod.

## Run and verify locally
- `pnpm --filter web test -- spend-monitor moderation-reports rights legal-pages` runs the focused suites.
- `node apps/web/scripts/cleanup-test-users.mjs` is dry-run by default. Add the apply flag only after reading its output. Do not run it on prod without the lead.
- `node apps/web/scripts/rights-fingerprint.mjs <file>` prints fingerprints for a protected text. Add entries to `apps/web/lib/rights/reference-fingerprints.json` (currently empty).
- Spend monitor: `/api/admin/spend-monitor` with the cron bearer secret. Cron runs 07:23 UTC.
- Reports: `/api/admin/reports`, `/api/admin/reports/resolve`, user-facing `/api/report`.

## Open risks
- Legal pages are not lawyer-reviewed. `docs/LEGAL-REVIEW.md` (on #76) lists the points.
- The grievance mailbox `grievance@neo-fm.com` must exist before launch (MANUAL-STEPS step 5).
- Rights screening is heuristic. The artist list is partial and the fingerprint list is empty, so verbatim detection only catches texts someone adds.
- Spend leaks are inferred from lyria_calls times price, because successful reservations are never settled. Real Lyria cost per song is still an estimate.
- Moderation emails go straight through Resend and are silent without a key.

## Next 3 steps
1. Merge #76 after the funnel and collections PRs, then get counsel to review Terms and Privacy.
2. Dry-run the cleanup script, give the output to S, then delete the test users in prod.
3. Seed `reference-fingerprints.json` with the lyrics most likely to be requested, and extend the artist list from real reports.
