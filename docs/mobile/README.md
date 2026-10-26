# Cross-platform foundation (increment 1)

Stacked on Draft PR27 at `12e3d11070f7fa803a8f2e9796f6f5027bcc7474`. This is an isolated foundation, not an enabled native financial release. The shared React/Vite merchant app and central API/Neon ledgers remain authoritative; no platform-specific merchant, subscription or financial identity is created.

## Build and configuration

- Node22.21+ / `npm ci` installs exact Capacitor8 packages from the lockfile.
- `npm run build` preserves the existing merchant/landing/admin web build.
- `npm run build:mobile` uses `vite.mobile.config.ts`, only `mobile/index.html`, no public-directory copy, no admin/landing entry, tracking snippet or browser service worker. A build check rejects privileged keys, admin/landing entries and source maps. Explicit merchant assets only.
- `npm run native:sync` builds the local merchant assets and copies them into both native projects. No `server.url`, wildcard navigation or live production web runtime.
- `npm run native:android:debug`: Java21 + Android SDK36 → debug APK. `npm run native:android:bundle`: release AAB, unsigned unless the four `NEWHOPE_ANDROID_*` signing variables are supplied. Do not distribute an unsigned artifact as a release.
- `npm run native:ios:simulator`: Xcode26+ / SPM → unsigned simulator build. For a device/archive, select the authorized Apple team and provisioning profile in Xcode, then Archive; no signing credentials are committed. No TestFlight upload performed.
- App identity `space.newhope.kasir`, initial version `0.1.0` build1. Change Android versionCode/versionName and iOS CURRENT_PROJECT_VERSION/MARKETING_VERSION together for each release. Identity must be confirmed before store enrollment.
- CI `native-foundation.yml` builds debug APK, unsigned AAB and iOS simulator app, with **unconfigured.invalid** API and no hosted Auth credentials. Compilation is not login or device acceptance.

For an isolated hosted staging build supply only public `VITE_NATIVE_API_ORIGIN` (HTTPS origin), `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`. Service-role/database/payment credentials are forbidden. The backend transport allowlist `NEW_HOPE_NATIVE_ORIGINS` is empty by default. On an approved staging backend only, set `capacitor://localhost,https://localhost`. CORS is not authorization: verified Bearer identities and existing server scope/RBAC remain mandatory. Native writes are gated in the client and POS mutation wrapper; this gate never replaces server authorization. Neither rollout flag is enabled by the mobile build.

## Runtime, authentication and data

Native HTTPS API remapping applies only to local `/api/` requests. Authorization is never automatically attached to external origins; API redirects fail rather than forwarding tokens. Web same-origin behavior remains. Routing compares protocol/host explicitly because custom-scheme URL origins may serialize as `null`.

Native Auth uses PKCE, system browser OAuth, the exact `space.newhope.kasir://auth/callback` callback, and one-use server code exchange. Cold/warm launch handlers reject mismatched paths, duplicate codes, fragments and extra redirect parameters. Add the exact callback to a **staging** provider allowlist before testing. Browser Auth keeps its existing implicit flow/storage key for session compatibility. Native sessions/verifiers use an app-private AES-GCM Android Keystore vault or iOS ThisDeviceOnly Keychain; bridge errors fail closed, never fall back to localStorage. Android backup is disabled. No synthetic native login fallback.

Foreground resume restarts token refresh and requests reconciliation through the existing coordinator. Background refresh is stopped; background execution is not promised. Sign-out retains pending operational queues. Membership/account revocation continues to be decided by the API, not by a cached native role. Password recovery requests retain PKCE verifier on the originating device and use the existing reset form. Hosted OAuth, password reset, session refresh, revocation, reinstall/key invalidation and physical-device secure storage remain unverified.

`commandStore.ts` is a transactional IndexedDB journal with strict durability requested, immutable commands, exact ACK deletion and tenant/merchant/outlet/module/actor/device scope. Tests cover reload, competing writes, altered payload rejection and scope isolation. **It is not wired into the legacy synchronous financial queues yet.** Native checkout/shift/cash and other API writes therefore fail closed. Browser queues remain unchanged and are not migrated, cleared or treated as server-confirmed payments. Device uninstall/storage eviction cannot be guaranteed safe by IndexedDB; a native SQLite adapter and physical termination/restart acceptance are outstanding before enabling native financial operations. A native gate is not a completed offline checkout workflow.

## PWA and device UX

Manifest launches `/overview`, with 192/512 icons; its explicit `/` app ID preserves the former start-URL-derived identity. Install help explains Chrome/Edge installation and iOS Share → Add to Home Screen. Existing worker caches only static shell/assets, excludes APIs and sensitive routes, and never activates aggressively over open cashier tabs. No worker registers in native runtime. The native build excludes external marketing tracking scripts. Shared small-screen input sizes, touch targets, safe areas and bounded dialogs are applied without enabling unfinished modules.

Capability interfaces support native product-photo capture and cache-backed file sharing, browser printing/export and keyboard scanners. Camera, Bluetooth printer protocols, barcode camera decoding, push/local notifications and native receipt printing are **not accepted hardware workflows**. Unsupported integrations return an explicit alternative, not fabricated success. Product camera selection is wired into the inventory editor; canonical report CSV export uses native sharing and PDF printing shows a browser alternative. These are code paths, not physical-device acceptance. No native payment redirect/return workflow is enabled; subscription purchase surfaces are replaced with an unavailable message, and DOKU configuration is unchanged.

## Distribution and security gates

Android permits Internet, disables cleartext/backup; camera access uses the official plugin and OS picker. iOS includes camera/photo purpose text and the Filesystem required-reason privacy manifest. Privacy labels/data-safety forms must reflect the eventual enabled features and backend collection, not merely this manifest. Universal/App Link association templates are supplied but not deployed or enabled: domain ownership, Apple team and release certificate fingerprints are required, along with an HTTPS callback handler and tests.

Review [Apple minimum functionality and payment rules](https://developer.apple.com/app-store/review/guidelines/) before distribution, especially 4.2 and 3.1.1/3.1.3. The companion/enterprise exceptions are not automatic approval for this SaaS; native subscription purchases and external purchase calls-to-action stay absent pending an explicit store-compliant design. Physical goods POS payment and New Hope SaaS subscription payment are distinct. TestFlight readiness also requires signed archive, privacy declarations, test credentials and review notes. No store publication is authorized here.

References: [Capacitor environment](https://capacitorjs.com/docs/getting-started/environment-setup), [App lifecycle](https://capacitorjs.com/docs/apis/app), [Supabase deep links](https://supabase.com/docs/guides/auth/native-mobile-deep-linking), [Filesystem privacy](https://capacitorjs.com/docs/apis/filesystem).

## Compatibility / acceptance matrix

| Workflow | Web / desktop PWA | Android | iOS |
|---|---|---|---|
| Shared canonical ledger / scopes | Existing PR27 regression suite | Same API contract; native writes gated | Same API contract; native writes gated |
| Merchant-only packaged shell | Existing web entries preserved | Bundled assets + Gradle project | Bundled assets + Xcode/SPM project |
| Installation | Manifest/icons/help; manual install still to verify | Debug APK CI | Simulator build CI; no signed IPA |
| Hosted account / PKCE / recovery | Existing Auth preserved | Implemented; hosted/device unverified | Implemented; hosted/device unverified |
| Two modules/outlets, cashier revenue/shifts | PR27 synthetic workflows | Cross-device workflow blocked | Cross-device workflow blocked |
| Transaction journal restart/conflict | Existing outbox tests | Adapter tests only; checkout integration missing | Adapter tests only; checkout integration missing |
| Camera/export/printing | Browser alternatives retained | Interface only, real device unverified | Interface only, real device unverified |
| Responsive Retail/Barber/F&B/Laundry/Carwash | Shared CSS; full per-screen visual acceptance pending | Pending physical acceptance | Pending physical acceptance |
| Universal/App Links | Templates only | Signed association + handler missing | Signed association + handler missing |
| Store distribution | N/A | Signing/store review pending | Signing/TestFlight/store review pending |

Run `npm run verify`, `npm run test:platform`, `npm run native:sync`, native CI, and both existing PostgreSQL17 jobs. Record exact commit/job results in the linked Draft PR. This matrix deliberately distinguishes implemented code, synthetic contract tests, native compilation, hosted workflow and physical-device evidence.
