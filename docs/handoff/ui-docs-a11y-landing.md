# Handoff: docs, accessibility, landing, ideas gallery, Kannada prosody, lyric meaning

## State
- Merged: docs pass (#22), PCE audit/interpret (#33), a11y pass + axe in smoke job (#69), wow landing page (#77), ideas gallery (#84), /ideas in sitemap (#90).
- Open, awaiting lead: #60 (docs nits + LAUNCH-CHECKLIST), #36 (Kannada prosody experiment scaffolding), #56 (lyric meaning panel).
- #56 needs migration 0076 applied to prod BEFORE merge.
- The Kannada prosody eval was never run (dropped by lead; needs a valid MA_ANTHROPIC_API_KEY). #36 only adds the scaffolding.

## Run and verify locally (from apps/web)
- `pnpm -r --filter "./packages/*" build` first (workspace packages).
- Smoke + axe (fake Supabase, no network): `pnpm test:smoke`; axe only: `pnpm test:a11y`. Pages audited in tests/smoke/a11y.spec.ts, dark and light.
- Unit: `npx vitest run tests/ideas.test.ts tests/landing-samples.test.ts tests/seo.test.ts`.
- Dev: needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY set (placeholders are fine for static pages).

## Where things live
- Ideas: lib/ideas/{types,catalog,data}.ts, app/(marketing)/ideas/page.tsx; prefill via `/songs/new?idea=<id>`.
- Landing: components/landing/*, lib/landing/{langs,samples,stats}.ts (stats hidden below 25 songs).
- Contrast clamp for text-foreground/30..55: app/globals.css.

## Open risks
- Ideas content (100 prompts, 5 languages) is NOT native-reviewed; the page shows a "pending native review" banner. Bengali keeps a few English loanwords in Bengali script; Kannada avoids them.
- Landing samples read public songs at runtime; with few public songs the section falls back to fewer samples.
- The a11y contrast fix is a global CSS clamp, not per-component edits; new low-alpha text classes outside 30..55 are not covered.

## Next 3 steps
1. Native speakers review lib/ideas/data.ts per language; edit text/gloss, keep ids stable.
2. Apply migration 0076, then merge #56; merge #60 and #36.
3. Wire Song of the Day (#61) into components/landing/social-proof.tsx once it lands.
