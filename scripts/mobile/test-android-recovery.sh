#!/usr/bin/env bash
set -euo pipefail
recovery_serial="$(adb get-serialno)"
case "$recovery_serial" in emulator-*) ;; *) echo 'Recovery tests require a disposable emulator.' >&2; exit 1 ;; esac
recovery_logs="${RUNNER_TEMP:-${TMPDIR:-/tmp}/newhope-android-recovery}"
mkdir -p "$recovery_logs"
cd android
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
for phase in prepareForProcessDeath recoverAfterProcessDeath corruptionPreservesOriginalFile; do
  adb shell am instrument -w -r -e class "space.newhope.kasir.FinancialDiskTest#$phase" space.newhope.kasir.test/androidx.test.runner.AndroidJUnitRunner > "$recovery_logs/$phase.txt"
  cat "$recovery_logs/$phase.txt"
  python3 - "$recovery_logs/$phase.txt" <<'CHECK'
import pathlib,sys
result=pathlib.Path(sys.argv[1]).read_text()
assert 'OK (1 test)' in result and 'FAILURES' not in result, result
CHECK
  adb shell am force-stop space.newhope.kasir
  adb shell am force-stop space.newhope.kasir.test
done
