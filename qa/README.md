# QA scripts

Run after every prod release (the "Prod release QA" scheduled task does this from a fresh session).

```
cd qa && npm install
npm run public     # sweep.js, i18n.js, queue.js, playback.js against https://www.neo-fm.com (QA_BASE overrides)
npm run staging    # staging-pass.js: signed-in pass on https://neo-fm-staging.vercel.app

`npm run checkout` (staging, signed in) opens a Stripe test Checkout Session per plan without completing it; Creator and Pro must work, the pass, annual plans and gift packs are reported as info when not configured.

`npm run create-song` (staging, signed in) checks a blank prompt is rejected and a real prompt is accepted and queued, then opens the song page. Staging has no music keys or worker, so nothing is generated. It needs the staging safety check to run in rules-only mode.
`npm run ads` (prod, signed out, part of `npm run public`) plays the station as a Free listener, skips ahead until the house-ad card shows, and checks it has its "From neo-fm" label, links to /gift or /pricing, and never sits inside a set.

`npm run taste` (staging, signed in) checks the English-first create page, the taste panel, that a song submitted with a taste set sends it, and that the station loads without page errors. It needs ENGLISH_MAIN, TASTE_BRIEF and STATION_PROGRAMMES on in staging. The song step reports a plan limit as info when an earlier queued test song still holds the QA user's concurrent slot (staging has no worker). Set `QA_TASTE_FRESH=1` to sign up a throwaway @neo-fm.test user through the app's own sign-up page instead, so a stuck test job cannot block it.

`npm run taste-save` (staging, throwaway user) checks the saved taste profile: Save without consent shows the consent note, Save with consent persists, a reload with the browser copy cleared prefills from the server, and Forget clears it. Needs migration 0113 on staging.

`npm run grades` (staging, throwaway Free user) checks the Premium/Studio lyrics picker: only Standard is selectable with no credit, a Premium request comes back Standard, and the add-on Checkout starts or reports "not on sale". Needs LYRIC_GRADES=1 and migration 0115 on staging.

`npm run week` (staging) checks /station/week and its API and share card, signed out and signed in at desktop and 390px. Needs STATION_WEEK on in staging.

`npm run features` checks the dedicate-this-hour link (banner, name cleaning, WhatsApp link) and that the push opt-in endpoints respond, on prod, no login needed.
```

- `sweep.js` prints only anomalies (non-200, overflow, console errors, missing h1) at desktop, 390 and 360px.
- `i18n.js` renders key pages in each UI language at 360px and desktop and flags overflow, raw keys and untranslated pages.
- `queue.js` checks every launch language (hi, ta, te, kn, mr) carries a spoken programme or host-link at each daypart.
- `playback.js` starts the station, plays and skips, and reports failed audio requests.
- `staging-pass.js` needs `QA_STAGING_EMAIL` and `QA_STAGING_PASSWORD` in the environment (never in this repo) and refuses prod hosts. Login takes 6 to 20 s, so it waits up to 30 s. `/collections`, `/api/station/queue` and `/api/events` 5xx are expected on staging until its service-role key is set.
- Browsers: uses the Chromium under `PLAYWRIGHT_BROWSERS_PATH` (default /opt/pw-browsers); set `QA_CHROMIUM` to override. Do not run `playwright install`.
- Never sign up or sign in on prod from these scripts. Signed-in prod checks (station playback, checkout) stay with the Mac Chrome session.
