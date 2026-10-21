# Manual steps to finish the neo-fm v2 launch

Only things Claude cannot do for you (they need your logins, money or DNS). Everything else, including model work (Opus, Sonnet, Haiku, Gemini), tests, PRs, deploys, migrations and production checks, is done by Claude and the project sessions without asking you.
Tell Claude "done: N" after each step. Never paste secret values in chat; paste them straight into the page named in the step.

Status as of 2026-10-12: all manual steps are closed. Nothing further is needed from you. ✅ done · ➖ not needed.

## Summary

| # | Step | Status |
|---|------|--------|
| 1 | Production on the neo-fm-prod Supabase project | ✅ done |
| 2 | Supabase auth settings, Google sign-in | ✅ done, including the new domain (2a) |
| 3 | Stripe test webhook | ✅ done, including the new domain (3a) |
| 4 | Domain neo-fm.com | ✅ done: DNS, Vercel domains, `NEXT_PUBLIC_APP_URL` |
| 5 | Email (Resend) | ✅ done and live (songs email on completion). The grievance contact is now `info@technektar.com`, so no mailbox forwarding is needed |
| 6 | Replace CRON_SECRET | ✅ done (rotated, live after redeploy) |
| 7 | Before public launch | ➖ not needed yet |
| 8 | Rate limiting store (Upstash) | ✅ done, `/api/health` reports upstash ok |
| 9 | Re-run agent setup | ➖ dropped by decision; step 6 is enough |
| 10 | Approve the paid test renders | ✅ approved and run |
| 11 | Try the share clip on real phones | ⏳ TODO |
| 12 | Soft-launch operations (test accounts, ADMIN_SECRET, leaked passwords, embedder, analytics, admin key) | ⏳ open |
| 13 | Stripe test dashboard: yearly plans, UPI, gift packs, UPI AutoPay | ⏳ open (test mode only) |

## Do these next, in this order
1. **2a** Supabase auth URLs for the new domain (2 minutes). Until then sign-in from the new domain may land on the vercel.app address.
2. **3a** Stripe webhook URL for the new domain.
3. **8** Upstash keys (free).
4. **9** Re-run agent setup.
5. **6** Rotate CRON_SECRET, then **7** go-live items.
6. **5** Resend: optional.

## What Resend is for
Resend would send one email: "your song is ready" when a song finishes (and later password/receipt style mail). It is optional for launch: songs work without it and the user sees completion in the app. The code does nothing if the key is absent. Do step 5 only when you want that email. `delivered@resend.dev` in the test-user list is just Resend's test inbox address, not a service we depend on.

## 1. Switch production to the neo-fm-prod Supabase project: ✅ DONE
Verified by Claude. Redeployed.

## 2. Supabase Auth settings: ✅ DONE (original URLs)
Done and checked: Site URL and redirect URL for `https://neo-fm-web.vercel.app`, Google OAuth client and provider, Pro plan.

### 2a. Add the new domain: ✅ DONE
1. Open https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/url-configuration
   - Site URL: `https://www.neo-fm.com`
   - Redirect URLs: add `https://www.neo-fm.com/**` (keep the vercel.app one too)
   - Save.
2. Open https://console.cloud.google.com/apis/credentials → your OAuth client. Only if it restricts domains: add `https://www.neo-fm.com` under Authorized JavaScript origins. The redirect URI stays `https://kgxltxvjlsnbwomklwox.supabase.co/auth/v1/callback`.
3. Tell Claude "done: 2a". Claude then runs a sign-in check on the new domain.

## 3. Stripe webhook (test mode): ✅ DONE
Endpoint created, signing secret saved in Vercel, and Claude verified a real checkout reaching the webhook and updating the plan.

### 3a. Point the webhook at the new domain: ✅ DONE
1. Open https://dashboard.stripe.com/test/webhooks → your endpoint → ⋯ → Update details.
2. Endpoint URL: `https://www.neo-fm.com/api/billing/webhook` → Save. The signing secret does not change.
3. Tell Claude "done: 3a". Claude runs a checkout test again.

## 4. Domain neo-fm.com: ✅ DONE
- Vercel: `neo-fm.com` and `www.neo-fm.com` are both added and verified. The canonical address is **`https://www.neo-fm.com`**; the bare `neo-fm.com` redirects to it (308).
- GoDaddy DNS: `A @ 76.76.21.21` and `CNAME www cname.vercel-dns.com`. Vercel shows a yellow "DNS Change Recommended" badge. That is only its newer IP range; the current records keep working, so ignore it.
- `NEXT_PUBLIC_APP_URL` is saved as `https://www.neo-fm.com` (Production and Preview), as a normal non-secret variable. Vercel cannot change a Sensitive variable to another type, which is why it had to be re-added. Claude redeployed.
- Never mark a `NEXT_PUBLIC_…` variable as Sensitive. It is public by design and Vercel refuses to save it.

## 5. Email: ✅ DONE except the mailbox
Resend domain, API key and Supabase secret are in place. Claude deployed the song-ready function, added the queue wrappers (migration 0087) and a 2-minute schedule, and checked that it reads the queue. Finished songs now email their owner.


## 6. Replace CRON_SECRET with a random value: ✅ DONE
1. In a terminal run `openssl rand -hex 32` and copy the output.
2. Open https://vercel.com/ss-projects-f08e52ab/neo-fm-web/settings/environment-variables → `CRON_SECRET` → Edit → paste → Production → Save.
3. Redeploy: https://vercel.com/ss-projects-f08e52ab/neo-fm-web/deployments → latest Production row → ⋯ → Redeploy.
4. Do step 9 after this step, using the new value.

## 7. Before public launch: ⏳ (not needed yet; only when you decide to go public)
1. Stripe live mode: https://dashboard.stripe.com/products → create live prices Creator ₹299/month and Pro ₹799/month; copy the live keys from https://dashboard.stripe.com/apikeys; create the live webhook at https://dashboard.stripe.com/webhooks (URL `https://www.neo-fm.com/api/billing/webhook`); update the Stripe variables in Vercel.
2. Delete test users at https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/users: `e2e-bot@neo-fm.test`, `showcase-a`, `showcase-b`, `delivered@resend.dev`.
3. Retire the old production Supabase project once nothing uses it: https://supabase.com/dashboard/projects → old project → Settings → General → Pause or Delete.
4. Ask a native speaker for each language to review a few songs and the translated screens.
5. Have counsel review the Terms and Privacy pages (the list of questions is in `docs/LEGAL-REVIEW.md` once PR #76 is merged).

## 8. Rate limiting store (Upstash Redis, free tier): ✅ DONE
Why: without it, per-IP rate limits live in memory on each serverless instance, so abuse protection is weak. `https://www.neo-fm.com/api/health` shows `upstash: missing` until this is set.
1. Open https://console.upstash.com/redis → Create database → region `ap-south-1` (Mumbai) → Free.
2. On the database page copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Open https://vercel.com/ss-projects-f08e52ab/neo-fm-web/settings/environment-variables → add both for Production (Sensitive is fine for these two) → Save → redeploy as in step 6.3.
(Alternative: install the Upstash integration from https://vercel.com/marketplace/upstash, which adds both variables for you.)

## 9. Re-run agent setup: ➖ dropped
Not needed; step 6 is enough.

## 10. Approve the paid test renders: ✅ DONE
Approved in chat and run; results are in the quality and latency reports.

## 11. Try the share clip on real phones: ⏳ TODO
Why: the clip export (PR #130) is only verified in desktop Chromium and with ffmpeg; Instagram and WhatsApp acceptance depends on the phone's browser. On one iPhone (Safari) and one Android phone (Chrome), open a finished song, tap Share, then "Make a vertical clip", and post the result to Instagram Reels and WhatsApp Status; tell the lead session which phone, whether the clip came out as MP4, and whether the app accepted it.

## 12. Soft-launch operations (S only; Claude changes nothing in prod config)
Upstash is already done (step 8). Context and verification: [docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md). Tell Claude "done: 12.N" after each.

1. **Delete the prod test accounts.** Open https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/users and delete `lat-bot@neo-fm.test`, `e2e-bot@neo-fm.test`, `showcase-a` and `showcase-b` (extends step 7.2).
2. **ADMIN_SECRET.** Run `openssl rand -hex 32` and add it as `ADMIN_SECRET` (Production) at https://vercel.com/ss-projects-f08e52ab/neo-fm-web/settings/environment-variables, then redeploy. Do this only after Claude confirms which PR reads it.
3. **Leaked-password protection.** Open https://supabase.com/dashboard/project/kgxltxvjlsnbwomklwox/auth/providers, Email provider, enable "Prevent use of leaked passwords" (needs the Pro plan from step 2.4).
4. **Embedder.** Check the Cloud Run service in https://console.cloud.google.com/run and tell Claude whether the latest revision is healthy or needs a rebuild. The app works without it.
5. **Vercel Web Analytics.** Open https://vercel.com/ss-projects-f08e52ab/neo-fm-web/analytics and click Enable. Claude adds the component in a PR.
6. **Anthropic admin key for the spend tracker.** Create an Admin API key at https://console.anthropic.com/settings/admin-keys and add it only as the cloud environment variable `MA_ADMIN_KEY` (not an ANT* name, those are blocked). Never paste it in chat. It is used read-only for `cost_report` and `usage_report`.
7. **Migrations 0072, 0076, 0078, 0086.** Apply each only after the lead has reviewed and merged its PR, and say go.

## 13. Stripe test dashboard: yearly plans, UPI, gift packs, UPI AutoPay: ⏳ OPEN (test mode only)
Everything here is in **Test mode** (the "Test mode" toggle on, or `dashboard.stripe.com/test/...`). Never do this in live mode. Dashboard labels move around; if one differs, search the dashboard for the word in bold. Never paste keys in chat.

**A. Yearly plans (needs PR #129 merged and deployed)**
1. Call `POST https://<app>/api/admin/stripe-setup` with header `Authorization: Bearer <CRON_SECRET>` (the response lists price ids, no secrets). It is idempotent and refuses a live key.
2. In Vercel > neo-fm-web > Settings > Environment Variables, add `STRIPE_PRICE_CREATOR_ANNUAL_ID` and `STRIPE_PRICE_PRO_ANNUAL_ID` from `prices.creator.inr_annual` and `prices.pro.inr_annual`. Redeploy. /pricing now shows the yearly buttons.
3. Webhook: Developers > Webhooks > your endpoint > **Update details** > add the event `checkout.session.async_payment_succeeded` (the existing events stay).

**B. Check UPI is available on this account**
4. Settings > Payments > **Payment methods**. Find **UPI**. If it is missing or shows "not available", stop and tell Claude what it says: Stripe's docs conflict on whether Indian accounts can enable it, and nothing below works without it.
5. If it is there, turn it **on** for test mode.

**C. Gift packs (do NOT do this until the /gift flow #128 spends credits)**
6. Apply migration 0089 only after #129 merges and you say go.
7. Only when #128 calls `consume_pack_song`: add `STRIPE_PRICE_PACK_SINGLE_ID` and `STRIPE_PRICE_PACK_THREE_ID` (from `packs.single.inr`, `packs.three.inr`) in Vercel, plus `STRIPE_PACK_UPI=1` if step 5 worked. Redeploy.

**E. Station pass (test mode only, #159)**
8. Run `POST /api/admin/stripe-setup` (test key). Add `STRIPE_PRICE_STATION_PASS_ID` from `station_pass.inr` in Vercel, redeploy. /pricing then shows the pass at ₹149 a month for signed-in users. The variable is ignored under a live key. S sets the final price before live mode.
9. Entitlement (#issue below): apply migration `0098_station_passes` when S names it. Applied on prod 2026-10-18; the webhook stores the pass and S's 2026-10-19 test payment is entitled. If a pass was bought before it was applied, resend the test-mode `customer.subscription.*` events for any pass bought earlier (Stripe dashboard > Developers > Events > Resend). Pass holders then get no ad breaks and a monthly allowance of personal tracks (default 4; set `STATION_PASS_MONTHLY_TRACKS` in Vercel to change it). The allowance is the per-user Lyria envelope (about 4 x 0.25 ledger GBP); the free tier's 3 songs a month row quota still applies on top.

**D. UPI AutoPay on subscriptions (flag, test mode only)**
8. Needs step 5. In Vercel add `STRIPE_SUBSCRIPTION_UPI=1`; it has no effect with a live key. Redeploy. Creator/Pro checkout then lists UPI next to card.
9. Test it: sign in, upgrade, pick UPI, use Stripe's test VPAs from `docs.stripe.com/payments/upi` (do not use a real UPI app). Confirm the account page shows the plan and the subscription appears in the test dashboard.
10. Not signed off for live mode: Stripe requires a pre-debit SMS or app notification at least 24 hours before each recurring charge with the exact amount, and a mandate cap (₹15,000 per Chargebee's docs). Claude has not verified Stripe sends the notification for you; check the AutoPay page in the Stripe docs before any live use.

**F. House ads (off by default, #212)**
1. Migration `0099_ad_slots` is applied on prod (`ad_slots`, `ad_events`, service role only, plus 12 inactive card-only house ads: gift song and Station pass, six languages). The queue works without it.
2. Copy review is Gemini scoring, not a native reader (S, 2026-10-17). The 10 Indic headlines scored 4 to 5 on 2026-10-19 (`launch/drafts/house-ad-gemini-scores-2026-10-19.json` in the project files); the polished gift lines go in with the launch card. To run a slot: set `reviewed_by`, `reviewed_at` and `active = true` on it.
3. In Vercel set `ADS_ENABLED=1` and redeploy. Unset it (or `active = false` on a slot) to turn everything off at once. Tiers follow `TIER_CAPS` in `lib/station/ads.ts`: Free and signed-out hear the most, Creator fewer, Pro the fewest and card-only, and a Station pass holder hears none (the pass beats every other tier).
4. Roll out to Free first for 48 hours and watch next-day return against the no-ads group; if it drops more than 10 percent for two weeks, cut Free to the Creator row (strategy/ads-revenue.md section 12).
5. Phone test: a card-only spot leaves about 6 seconds without audio. The player drops it when the page is hidden (or ends it if the phone locks mid-card), but check on a locked phone that the next track starts by itself.
6. Spoken spots (off by default): `ADS_AUDIO_ENABLED=1` lets a slot with `audio_path` play its audio; without it every slot is served as a card, so cards stay live while audio is off. Render the spots with `scripts/ad-spots-render.mts --slots slots.json` (plan first with no `--reserved`; a render costs one Gemini TTS request per slot, about 12 for the six languages, reserved through `reserve_provider_call('tts','batch',...)`, S taps the spend), then attach each mp3 with `POST /api/admin/ad-spots` (multipart: file, slot_id, duration_seconds, ai_made=true), which uploads `ads/<id>.mp3` and sets `audio_path`, `duration_seconds`, `ai_made`. Spoken AI spots are labelled "From neo-fm" and flagged `ai_made`. Pro and the pass never get audio (`TIER_CAPS`). Turn audio off again by unsetting `ADS_AUDIO_ENABLED`.
7. Break placement and the pass upsell (both off by default, both go through the QA release train): `ADS_BREAK_BOUNDARIES=1` puts a break only directly after a programme or Almanac voice segment or after the last track of a mood set (voice segments are placed first, so a break may follow one); with no boundary in a queue slice there is no break until the next refill, so watch `inventory.startsPerDay` in `GET /api/admin/ads` after enabling. `ADS_PASS_UPSELL=1` makes the break after every 3rd break of a session (3rd, 6th, ...) a Station pass creative (a house ad whose `cta_url` is `/pricing`) for Free listeners on the web; the Capacitor shell never sees it. Both honour the 10% holdout: held-out Free listeners hear no ads, and `GET /api/admin/listening` returns `by_arm` (holdout vs exposed session length, tracks per session, skip rate); `GET /api/admin/ads` returns `pass_upsell` (starts, completes, taps, tap rate on pass creatives).
8. Paid tiers ad-free (off by default, release train): `ADS_PAID_FREE=1` makes Creator, Pro and live subscribers hear no ads at all, like the Station pass (`adTierFor` returns null); Free (and signed-out) listeners are unchanged. Without it Creator and Pro keep the lighter `TIER_CAPS` rows. Sponsor inventory then comes from Free listeners only (`strategy/sponsor-media-kit.md` section 1).

**G. Spoken station links (off by default)**
1. Nothing to apply: the lines are static files under `apps/web/public/voice` and an index in `lib/station/voice-lines.json`, built by `node scripts/voice-lines-build.mjs` from the media lab TTS run. No migration, no spend.
2. Score the lines with the Gemini nativeness gate first (lab/nativeness, overall 4 or more, bad controls scoring 2 or less). All lines are AI-voiced; word any claim as "scored by Gemini", never "native-reviewed". There is no human listen for now.
3. In Vercel set `STATION_VOICE_LINKS=1` and redeploy. Unset it to turn all spoken links off at once. Leave `STATION_VOICE_TIMECHECK` unset: those lines say the exact hour and a queue is built up to about 25 minutes ahead of its last song.
4. Phone test: on a locked phone, check the next song starts by itself after a spoken link, and that skip on a link goes straight to the song.
