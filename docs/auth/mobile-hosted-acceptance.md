# Installed native authentication acceptance

No installed provider acceptance is implied by these commands. Keep native financial checkout and both module rollout flags OFF. Do not reset the owner authenticator, clear app data, uninstall an app holding journals, export tokens, or use production accounts/data. Record NOT RUN until each actual workflow completes.

## Read-only preflight

From the repository root, run `node scripts/mobile/auth-acceptance-preflight.mjs`. Exit2 means prerequisites are BLOCKED; JSON is saved at `build/native-auth-acceptance/preflight.json`. Install official Android SDK/platform-tools plus emulator image, or full Xcode plus an iOS simulator runtime, on an authorized test machine. Set ANDROID_HOME/ANDROID_SDK_ROOT if adb is not on PATH. Boot one disposable emulator/simulator and rerun. Multiple devices require explicit serial/UDID selection; do not assume a physical device is disposable.

The existing public configuration points to **PR29**, with native API `https://auth-staging.newhope.space` and its original canonical issuer. It does not point to PR30 staff staging. Do not silently repoint this domain or copy credentials. PR30 installed staff acceptance additionally requires an approved PR30 native-reachable API/issuer configuration; its current Preview SSO blocks unauthenticated native calls. Never put a Vercel bypass token into the app.

## Reproducible configured build and installation

Use Node22, Java21 and current supported SDK/Xcode. From a clean checkout of the recorded commit:

```sh
npm ci
node scripts/mobile/check-auth-staging-api.mjs
node scripts/mobile/build-auth-staging.mjs
(cd android && ./gradlew assembleDebug lintDebug)
# Select an emulator serial from `adb devices -l` before executing:
adb -s EMULATOR_SERIAL install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s EMULATOR_SERIAL shell am start -n space.newhope.kasir/.MainActivity
```

For iOS, reuse the configured assets produced above:

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug -derivedDataPath build/ios-auth-staging CODE_SIGNING_ALLOWED=NO build
xcrun simctl list devices booted
xcrun simctl install SIMULATOR_UDID build/ios-auth-staging/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch SIMULATOR_UDID space.newhope.kasir
```

Do not run the ordinary native build command afterward: it can regenerate assets without staging configuration. Record commit, artifact SHA256, OS/runtime version and provider/issuer/API origin before login. Use an authorized staging recipient and enter passwords/TOTP/recovery privately. Existing owner enrollment must remain unchanged.

## Human workflow and evidence

| Test | Required observation |
|---|---|
| Password login | Correct canonical staff ID and exact assignments; wrong password denied; no owner tenant/trial created |
| Google OAuth | System browser opens expected canonical issuer; authorized tester completes login; callback `space.newhope.kasir://auth/callback` returns to same app; no token in URL/screenshots |
| PKCE/replay | Normal handoff completes once; duplicate callback cannot mint another session; cancelled or foreign-state callback leaves current identity unchanged. Protocol adversarial cases also run in test:neon-auth; do not fabricate handoff codes for a claimed real-provider test |
| MFA | Existing enrolled staff signs in and passes TOTP; first factor alone cannot use protected API; never re-enroll owner for a staff test |
| Backup recovery | User privately uses one unused staff recovery code; login succeeds but does not count as fresh TOTP administrative proof; reuse rejected |
| Password reset | User follows actual delivered reset email and sets password privately; previously active browser and native sessions denied; new password login succeeds |
| Session refresh/restart | Record canonical/session identifiers only; force-stop Android with `adb -s EMULATOR_SERIAL shell am force-stop space.newhope.kasir`, then relaunch. For iOS use `xcrun simctl terminate SIMULATOR_UDID space.newhope.kasir`, then launch. Same identity restored through platform secure storage; no token copied to logs |
| Two users/devices | Separate device/profile sessions have different canonical IDs; one logout does not log out the other; no cache/queue crossover |
| Revocation | Owner/delegated administrator revokes exact test membership; next online API read/write denied immediately without waiting for client refresh; historical actors unchanged |
| Offline reconnect | Disconnect networking through test-device controls; only permitted offline identity state restored. Queue IDs/counts unchanged. Reconnect after revocation: server denies scope and queue remains preserved, never reassigned |
| Logout | Online logout invalidates session and secure bearer; restart cannot restore privileged session; journals remain intact |
| Scope | Foreign merchant, sibling unauthorized outlet and wrong module denied by server; record status/error and synthetic target labels, never bearer tokens |

Save bounded evidence per platform: UTC time, code/artifact hash, synthetic identity labels, route/status/error, canonical-ID equality comparisons, journal counts/hashes and redacted screenshots. SDK build success, CORS204, an app launch or synthetic HTTP tests cannot mark any provider login row PASS. Physical-device acceptance is a separate run after emulator/simulator acceptance.
