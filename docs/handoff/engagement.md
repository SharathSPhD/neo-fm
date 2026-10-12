# Handoff: engagement features (charts, collections, language versions, notifications, month recap)

## State
All five PRs are merged: #61 charts (0079), #70 collections (0081), #74 language versions (0084), #80 notifications centre (0085) and #85 month recap (no migration). Notifications are in-app only. Web push is dormant unless `NEO_FM_WEB_PUSH_ENABLED=true` and the VAPID keys are set. The `collection_add` producer is wired in `app/api/collections/[id]/items/route.ts`.

## Run and verify locally
From the repo root: `pnpm install`, then `pnpm -C apps/web exec tsc --noEmit` (remove `apps/web/.next` first if it errors on stale types), `pnpm -C apps/web exec vitest run`, and `node scripts/check-migrations-security.mjs`.
Recap: `/recap` (signed in), image at `/api/recap/image?month=YYYY-MM&lang=hi`. Notifications: bell in the app shell, `/account/notifications`.

## Open risks
- Notifications and recap strings (bell, settings, recap nav link) are English literals, not locale-file keys. The recap image has its own 6-language strings.
- The mood-label translations in `lib/recap/moods.ts` are machine-translated and need a native-speaker review.
- Migration 0085: `notify_user` is SECURITY DEFINER and the push-subscription cap is a trigger. Re-run the lint after any edit.

## Next 3 steps
1. Move the bell, settings and recap nav strings into the locale files.
2. Get a native-speaker review of the recap mood labels.
3. Optional: a public recap link (needs a migration) and later web-push enablement.
