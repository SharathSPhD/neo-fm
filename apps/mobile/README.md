# @neo-fm/mobile

Capacitor 8 shell for Android and iOS. It loads the live web app (`server.url`), adds the native pieces a 24/7 station needs (background audio, lock-screen controls, share sheet, deep links) and hides purchase UI that the stores forbid. Plan and decisions: `docs/MOBILE.md`; release rules: `docs/RELEASE-POLICY.md`.

```sh
pnpm install
cd apps/mobile
npx cap add android   # once; the android/ project is committed
npx cap sync android
cd android && ./gradlew assembleDebug   # APK in app/build/outputs/apk/debug
```

iOS needs macOS: `npx cap add ios && npx cap sync ios`, then build with `xcodebuild` or Xcode. Signing keys are never committed.
