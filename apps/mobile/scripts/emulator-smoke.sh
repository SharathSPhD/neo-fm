#!/usr/bin/env bash
# Runs inside the emulator job: install the APK, launch, drive it with android-smoke.mjs, keep evidence.
set -uo pipefail
APK="${1:?apk path}"
OUT="${2:-smoke-out}"
mkdir -p "$OUT"
# Upgrade install: put the last released beta on first, leave a marker in its private storage, then install this build over it.
# Same signing key => the install must succeed and the app's data must survive. Skipped where the old release can't be fetched.
PREV_TAG="${NEO_FM_PREV_TAG:-mobile-v0.4.0}"
if [ -n "${GH_TOKEN:-}" ] && gh release download "$PREV_TAG" -p '*.apk' -O "$OUT/previous.apk" --clobber 2>/dev/null; then
  adb install -r "$OUT/previous.apk" >/dev/null && adb shell am start -n com.neofm.app/.MainActivity >/dev/null
  sleep 8
  if adb shell run-as com.neofm.app sh -c 'echo upgrade-marker > files/upgrade-marker' 2>/dev/null; then
    old_ver=$(adb shell dumpsys package com.neofm.app | grep -m1 versionName | tr -d ' ')
    if adb install -r "$APK" 2>&1 | tee "$OUT/upgrade-install.log" | grep -q Success; then
      kept=$(adb shell run-as com.neofm.app cat files/upgrade-marker 2>/dev/null | tr -d '\r')
      new_ver=$(adb shell dumpsys package com.neofm.app | grep -m1 versionName | tr -d ' ')
      if [ "$kept" = "upgrade-marker" ]; then echo "PASS upgrade install over $PREV_TAG keeps app data ($old_ver -> $new_ver)"; else echo "FAIL upgrade install lost app data ($old_ver -> $new_ver)"; exit 1; fi
    else
      echo "FAIL upgrade install over $PREV_TAG was refused: $(cat "$OUT/upgrade-install.log")"; exit 1
    fi
  else
    echo "diag upgrade install: previous build is not debuggable, data check skipped"
  fi
else
  echo "diag upgrade install skipped: previous release not available in this run"
fi
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
node "$(dirname "$0")/android-journey.mjs" "$OUT/journey" 2>&1 | tee "$OUT/journey.log"
journey=${PIPESTATUS[0]}
[ "$status" -eq 0 ] && status=$journey
adb logcat -d -t 400 > "$OUT/logcat.txt" || true
exit "$status"
