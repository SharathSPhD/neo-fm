# Handoff: SEO growth, creator profiles, embeds

Area owner thread: SEO / profile / embed. Status as of 2026-10-12: all PRs merged to main (#50 SEO base, #58, #66 avatar upload, #75 embed polish, #82 SEO growth). No open PRs, no migrations, nothing under `lib/agent/*`.

## State
- **Embeds**: `/s/<id>/embed` iframe (`?layout=compact|full&theme=auto|light|dark`), synced lyrics, "made with neo-fm" link. `frame-ancestors *` only on that route. oEmbed at `/api/oembed` (same-host URLs only; private, taken-down and unknown songs all return the same 404). Code: `lib/embed/*`, `app/s/[publicId]/embed/*`, builder in `app/(app)/songs/[id]/embed-builder.tsx`.
- **Profiles**: bio (`lib/profile/bio.ts`, no links) and avatar upload (`app/api/account/avatar/route.ts`: sniffed format, metadata stripped, AI moderation fails closed, atomic claim plus compare-and-set so the upload throttle is not racy). Account export and delete already cover handle, bio and avatar.
- **SEO**: robots, sitemap, canonicals (`lib/seo/site.ts`, `app/sitemap.ts`); JSON-LD (`lib/seo/jsonld.ts`) for songs, `/discover`, profiles and explainers; five language landing pages `/ai-songs/{hindi,tamil,telugu,kannada,bengali}` plus a `/how-it-works` explainer each, localized OG images, hreflang cluster, top public songs (`lib/seo/top-songs.ts`, cached 10 min). Dedicated songs are noindex and excluded from the sitemap and top lists.
- **Song-ready email**: not touched by this thread's final PRs; see the email owner's notes. Nothing email-related ships from this area.

## Run and verify locally
```
cd apps/web && pnpm install
pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run
pnpm exec vitest run tests/seo-growth.test.ts tests/embed.test.ts tests/app/api/oembed.test.ts tests/app/api/avatar-upload.test.ts tests/profile-bio-avatar.test.ts
```
With a production build (`pnpm build && pnpm start`): `/ai-songs/tamil` returns 200 with 7 hreflang links; `/ai-songs/nope` and `/ai-songs/nope/how-it-works` return 404; `/sitemap.xml` lists the language pages; `/api/oembed?url=<host>/s/<id>` returns JSON for a public song and 404 for anything else. Unknown-slug 404s only work because the pages live in `app/ai-songs/`, not the `(marketing)` group (its loading boundary commits 200 first); a test pins that.

## Open risks
1. **Language copy is unreviewed.** All hi/ta/te/kn/bn page and article text (`lib/seo/language-pages.ts`, `language-articles.ts`) was written by Claude. Needs a native-speaker pass before launch; the review kit (#46) is the intended vehicle.
2. Machine-written claims in the explainers mirror `/trust`; if the pipeline changes, update both.
3. `frame-ancestors *` on the embed route is intentional; any new CSP work (#78) must keep that exception.
4. Any new table written with the user's session must be added to the migration 0083 grant list.
5. Profile screenshots under `docs/screenshots` are stale (folder is gitignored).

## Next 3 steps
1. Get native-speaker review of the five languages; fix copy in the two `lib/seo` files.
2. Submit the sitemap in Search Console after the domain is final and check the hreflang report.
3. Watch `/discover` and top-song pages for thin or low-quality public songs, and tighten the ranking in `top-songs.ts` if needed.
