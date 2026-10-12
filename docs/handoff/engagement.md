# Handoff: engagement features (charts, collections, language versions, notifications, month recap)

## State
- #61 charts: merged, migration 0079 applied.
- #70 collections: merged, migration 0081 applied.
- #74 language versions: open, in the lead's queue. Migration 0084 is already applied on prod.
- #80 notifications centre: open, queued after #74. Needs migration 0085 applied right before merge. In-app only; no notification emails. Web push is dormant unless `NEO_FM_WEB_PUSH_ENABLED=true` and the VAPID keys are set. The `collection_add` producer is wired in `app/api/collections/[id]/items/route.ts`.
- #85 month recap: open, queued after #80. No migration. Needs #80 and #74 merged first only for conflict-free merges, not for function.

## Run and verify locally
From the repo root: `pnpm install`, then `pnpm -C apps/web exec tsc --noEmit` (remove `apps/web/.next` first if it errors on stale types), `pnpm -C apps/web exec vitest run`, and `node scripts/check-migrations-security.mjs`.
Recap: `/recap` (signed in), image at `/api/recap/image?month=YYYY-MM&lang=hi`. Notifications: bell in the app shell, `/account/notifications`.

## Open risks
- Notifications and recap strings (bell, settings, recap nav link) are English literals, not locale-file keys. The recap image has its own 6-language strings.
- The mood-label translations in `lib/recap/moods.ts` are machine-translated and need a native-speaker review.
- Migration 0085: `notify_user` is SECURITY DEFINER and the push-subscription cap is a trigger. Re-run the lint after any edit.
- Before 0085 is applied, the notification code is a tolerant no-op.

## Next 3 steps
1. Merge #74, apply 0085, merge #80, merge #85 (sync main into each after the previous merge).
2. Move the bell, settings and recap nav strings into the locale files.
3. Optional: public recap link (needs a migration) and push enablement later.
