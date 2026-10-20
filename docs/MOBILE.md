# Mobile apps

Capacitor 8 shell (`apps/mobile`) over the live web app. Full brainstorm, options, store rules and test strategy: project file `mobile/plan.md`. Release rules: [RELEASE-POLICY.md](RELEASE-POLICY.md).

- **Beta distribution (no paid accounts, no approvals)**: Android debug-signed APK from the `mobile-android` workflow, attached to a GitHub Release on a `mobile-v*` tag, sideloaded; iOS via the PWA (Add to Home Screen), plus free-Apple-ID Xcode builds on S's own devices. Play and App Store accounts are later and optional.
- **Shell detection**: the shell appends `NeoFmApp/<ver> (android|ios)` to the user agent; `lib/native/app-shell.ts` parses it. In the shell, pricing buttons become plain text and `/api/billing/checkout` returns 403 `purchases_on_web` (store rules on digital goods). Stripe stays in test mode.
- **Build**: `cd apps/mobile && npx cap sync android && cd android && ./gradlew assembleDebug`. `NEO_FM_SHELL_URL` points a debug build at a preview deployment.
- **Sign-in**: Google OAuth is hidden in the shell (Google blocks embedded WebViews); email sign-in works. System-browser return needs a Supabase redirect allowlist entry, later.
- **Background audio**: on Android the page reaches `@capgo/capacitor-media-session` through `window.Capacitor` (`lib/native/media-session-bridge.ts`) for the foreground media service and lock-screen controls; iOS relies on `navigator.mediaSession`. Verify on a device each mobile major release.
- **Emulator e2e**: `apps/mobile/scripts/android-smoke.mjs` (run by the `mobile-android` workflow on mobile PRs, tags and manual runs) drives the installed APK over DevTools: live origin and shell UA, no purchase UI and checkout 403, no Google sign-in, station audio plays, media notification and session, playback survives screen-off. A real phone check is still owed to S.
- **Never commit** keystores or signing secrets.
