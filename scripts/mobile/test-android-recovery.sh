#!/usr/bin/env bash
set -euo pipefail
cd android
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
for phase in prepareForProcessDeath recoverAfterProcessDeath corruptionPreservesOriginalFile; do
  adb shell am instrument -w -r -e class "space.newhope.kasir.FinancialDiskTest#$phase" space.newhope.kasir.test/androidx.test.runner.AndroidJUnitRunner > "$RUNNER_TEMP/$phase.txt"
  cat "$RUNNER_TEMP/$phase.txt"
  python3 - "$RUNNER_TEMP/$phase.txt" <<'CHECK'
import pathlib,sys
result=pathlib.Path(sys.argv[1]).read_text()
assert 'OK (1 test)' in result and 'FAILURES' not in result, result
CHECK
  adb shell am force-stop space.newhope.kasir
  adb shell am force-stop space.newhope.kasir.test
done
