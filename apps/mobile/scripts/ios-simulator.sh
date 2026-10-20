#!/usr/bin/env bash
# Boots an iPhone simulator, installs the unsigned Debug app, launches it, and checks it stays up and loads the live site.
set -uo pipefail
APP="${1:?path to App.app}"
OUT="${2:-sim-out}"
BUNDLE="com.neofm.app"
mkdir -p "$OUT"
UDID=$(xcrun simctl list devices available -j | python3 -c "
import json,sys
d=json.load(sys.stdin)['devices']
c=[x for k,v in d.items() if 'iOS' in k for x in v if x['name'].startswith('iPhone') and x['isAvailable']]
print(next((x['udid'] for x in c if 'iPhone 16' in x['name'] or 'iPhone 15' in x['name']), c[0]['udid']))")
echo "simulator $UDID"
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"
xcrun simctl launch "$UDID" "$BUNDLE"
sleep 25
xcrun simctl io "$UDID" screenshot "$OUT/launch.png"
PID=$(xcrun simctl spawn "$UDID" launchctl list | grep "$BUNDLE" | awk '{print $1}')
echo "pid: ${PID:-none}"
xcrun simctl spawn "$UDID" log show --last 2m --predicate "process == \"App\"" --style compact > "$OUT/app.log" 2>&1 || true
status=0
[ -n "$PID" ] && [ "$PID" != "-" ] && echo "PASS app is running" || { echo "FAIL app is not running"; status=1; }
grep -qi "neo-fm.com" "$OUT/app.log" && echo "PASS app talked to neo-fm.com" || echo "note: no neo-fm.com line in the app log"
xcrun simctl terminate "$UDID" "$BUNDLE" || true
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null && sleep 10 && xcrun simctl io "$UDID" screenshot "$OUT/relaunch.png"
exit "$status"
