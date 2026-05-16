# neo-fm v1.1 deep-dive — demo bundle

This is the v1.1 close-out smoke handoff. The companion docs that
were rewritten in the same release are:

- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- [docs/REPRODUCIBILITY.md](../../docs/REPRODUCIBILITY.md)
- [docs/PRODUCTION-MIGRATION.md](../../docs/PRODUCTION-MIGRATION.md)
- [docs/SECURITY.md](../../docs/SECURITY.md)
- [docs/RUNBOOK.md](../../docs/RUNBOOK.md)

ADRs new in this release: 0019 (app shell), 0020 (vocal multi-backend
+ eval), 0021 (security-definer review).

## 1. What this bundle proves

A reviewer running through this folder + the four corresponding
URLs should be able to verify, in under 10 minutes:

1. The signup -> email-confirm -> in-app flow does **not** land on
   the Vercel SSO challenge (Sprint C (a)).
2. A queued song never gets stuck in `processing` -- either it
   completes, or the **Recover** button in `/library` re-queues it
   transparently (Sprint C (b)).
3. The library shows readable song titles instead of UUID stubs
   (Sprint C (c)).
4. Vocal output is preprocessed (NFC, ZWJ/ZWNJ, halant rules, IPA,
   prosody) and routed across kenpath/svara-tts-v1 ->
   ai4bharat/indic-parler-tts -> fake, with the chosen backend
   stamped on each `tracks` row (Sprint D).
5. Pricing, account, help, and feedback surfaces all render at
   `/pricing`, `/account`, `/help`, `/feedback` (Sprint E).
6. Library search / filter / sort / favorite / rename / delete /
   onboarding modal all work (Sprint F).
7. Discover feed at `/discover`, public profile at `/u/<handle>`,
   likes/follows visible end-to-end (Sprint G).
8. Five wow factors visible: live spectrogram on the player, stem
   downloads, AI cover art, "Make a variation" button, lyrical
   karaoke ticker (Sprint H).
9. Every response carries CSP / HSTS / Permissions-Policy headers
   and `/api/health` returns a structured payload (Sprint I).
10. The Supabase advisor sweep returns only the "ACCEPTED" warnings
    documented in ADR 0021.

## 2. Test sweep (must be green before merge)

```sh
# typescript + js
pnpm -r --filter=!@neo-fm/* typecheck   # all packages
pnpm --filter=@neo-fm/web typecheck
pnpm -r test                            # 77 web + 18 song-doc + 7 style-presets + 24 lyrics + 43 co-composer

# python
cd services/vocal-synth     && uv run pytest -q   # 34 passed
cd services/dgx-worker      && uv run pytest -q   # 41 passed (1 skipped)
cd services/music-inference && uv run pytest -q   # 26 passed
```

The exact counts above are from the v1.1 close-out sweep, 2026-05-16.

## 3. HTTP smoke (local)

```sh
pnpm --filter=@neo-fm/web dev
# in another shell:
curl -sS http://localhost:3000/api/healthz | jq
curl -sS http://localhost:3000/api/health  | jq
# Verify these response headers (look for the values, not just the names):
curl -sI http://localhost:3000/ | grep -iE 'strict-transport|content-security-policy|x-frame-options|permissions-policy|referrer-policy|x-content-type-options'
# Embed surface uses a relaxed CSP:
curl -sI http://localhost:3000/embed/EXAMPLE | grep -iE 'content-security-policy|frame-ancestors'
```

## 4. HTTP smoke (production)

After merge + Vercel auto-promote:

```sh
curl -sS https://neo-fm.vercel.app/api/health  | jq
curl -sI https://neo-fm.vercel.app/            | grep -iE 'strict-transport|content-security-policy'
# Sanity: discover renders without an auth cookie
curl -sI https://neo-fm.vercel.app/discover    | head -10
# Public profile renders without an auth cookie
curl -sI https://neo-fm.vercel.app/u/handle-that-exists | head -10
```

`/api/health` should report `status: "ok"` with `checks.supabase.status
= "ok"`. If `checks.upstash.status` is `missing`, the in-memory
rate-limit fallback is in use; that's fine but should not be the
long-term state for prod.

## 5. Eyeball checks

Sign up with a never-before-used email at https://neo-fm.vercel.app:

1. Confirm the welcome email link drops you into the app (not the
   Vercel SSO challenge).
2. Create a song with the **Carnatic kriti** preset; rename it; mark
   it as favorite; play it -- the spectrogram should animate.
3. Click **Make a variation**. Verify a sibling job appears with
   the same Song Document seeded.
4. Click **Generate cover art**. After ~5 s a square cover appears.
5. Open `/library`, search for the song title, sort by Recently
   updated, toggle "favorites only", delete a different test song.
6. Open `/discover`, click into a song, click the heart button.
7. Open `/onboarding/handle`, pick a handle, navigate to
   `/u/<handle>` -- the public profile renders without auth.
8. Open `/account`, click **Export data**, verify the JSON includes
   profile + jobs.
9. Hit `/pricing`, join the Creator waitlist; verify
   `select * from public.waitlist order by created_at desc limit 5;`
   in Supabase shows the entry.
10. Hit `/feedback`, submit one; verify
    `select * from public.feedback order by created_at desc limit 5;`
    shows the entry.

## 6. Files in this bundle

| File | Purpose |
| --- | --- |
| `SMOKE-HANDOFF.md` | this file |
| `advisor-sweep-2026-05-16.json` | raw output of `get_advisors type=security` after migration 0027 |
| `routes-inventory.md` | every route added in v1.1 + the role it serves |
| (optional) `demo-walkthrough.gif` | recorded eyeball walkthrough — capture on the actual demo machine, not in CI |

The PR description should link to this folder.
