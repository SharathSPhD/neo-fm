#!/usr/bin/env bash
# Runs inside the emulator job: install the APK, launch, drive it with android-smoke.mjs, keep evidence.
set -uo pipefail
APK="${1:?apk path}"
OUT="${2:-smoke-out}"
mkdir -p "$OUT"
adb install -r "$APK"
adb shell pm grant com.neofm.app android.permission.POST_NOTIFICATIONS || echo "no POST_NOTIFICATIONS permission declared"
adb shell am start -n com.neofm.app/.MainActivity
sleep 20
adb shell dumpsys activity activities | grep -q com.neofm.app || { echo "app not in foreground"; exit 1; }
adb exec-out screencap -p > "$OUT/launch.png"
node "$(dirname "$0")/android-smoke.mjs" 2>&1 | tee "$OUT/smoke.log"
status=${PIPESTATUS[0]}
adb exec-out screencap -p > "$OUT/final.png" || true
node "$(dirname "$0")/android-layout.mjs" "$OUT/layout" 2>&1 | tee "$OUT/layout.log"
layout=${PIPESTATUS[0]}
[ "$status" -eq 0 ] && status=$layout
adb logcat -d -t 400 > "$OUT/logcat.txt" || true
exit "$status"
