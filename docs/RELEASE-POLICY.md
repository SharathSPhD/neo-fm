# Release policy: web and mobile

Mobile (Android, iOS) syncs with web on every **major** release for now; later on every release. Decided by the lead, 2026-10-20.

**Major** (mobile build cut, mobile QA pass, version bump): adds or turns on a user-facing feature or flag; changes auth, payments or pricing; applies a DB migration; changes the native shell or its plugins.

**Minor** (web only; the Capacitor shell loads the live site, so it picks the change up at once): bug fixes, copy and translations, content and tracks, styling.

Tie-break: if a user can do something today they could not yesterday, or the shell binary changes, it is major.

Process: the PR description says MAJOR or MINOR. After a major prod deploy, Launch QA runs the full pass on web, Android and iOS. Web tags are dated; mobile tags are `mobile-v<semver>` and a `mobile-v*` tag, or the workflow run manually with `release_tag`, builds the beta APK and attaches it to a GitHub Release.

## Release train (automatic)

Mobile follows the web train with no approval step (S, 2026-10-21): web staging e2e, then prod, then the QA thread dispatches `mobile-train` with the live commit. A MAJOR release (see above; PR descriptions put `MAJOR` or `MINOR` at the start of a line) builds the shell against staging, runs the Android emulator journey and the iOS simulator and WebKit checks, and only then ships the production build: GitHub prerelease with the APK, and Google Play internal then a staged production rollout once `PLAY_SERVICE_ACCOUNT_JSON` exists. iOS store submission waits for an Apple Developer account. Details: `strategy/release-train.md`, `.github/workflows/mobile-train.yml`.
