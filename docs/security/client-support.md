# Customer & Support (QA follow-up, 4 October 2026)

Customer means a SaaS account/tenant and its owner, not a store's shoppers.
The existing admin auth, membership guard, audit tables, and Supabase session
remain authoritative. No parallel identity store or financial sync mechanism.

## Operator workflow

1. Open **Customer & Support**, search account name/ID, select **Kelola & bantu**.
2. Enter a support reason/ticket (at least 10 characters) to read private details.
3. Check the account's verified Auth email, business/outlet status, server
   transaction count/date, and support history. Offline queues are not visible
   here; a server count is not proof all devices are synced.
4. Support/superadmin can append a support note. Superadmin can update the SaaS
   account name only; not the login email, owner identity, outlet name, or ledger.
5. Password assistance sends a recovery email to the **current verified owner
   Auth email**. Requires an explicit owner-request confirmation, reason, and
   a server-verified `aal2` session with MFA completed within 10 minutes.
   This check applies to real UUID subjects as well as test subjects.
6. Subscription actions/detail now open in an accessible right-side drawer
   (full-width on small screens), retaining the selected table context. Escape,
   focus trapping/restoration and a disabled-close saving state are supported.

## Password recovery boundaries

- Only the server reads `SUPABASE_SERVICE_ROLE_KEY`; it is absent from browser
  assets. Customer email/password/redirect overrides from an operator request
  are ignored. No admin receives a password, token, or recovery link.
- The destination is server-configured `APP_URL` + `/reset-password` (HTTPS,
  default `https://kasir.newhope.space/reset-password`). Owner completes the
  form using the existing Supabase session from the email link.
- Request intent is audited **before** contacting Auth, then an immutable
  outcome is appended. Profile update and audit are one database transaction.
- Two-minute reset cooldown per tenant. Repeating an intent key checks its
  outcome and never sends another email with that key. Only a nonsensitive
  intent ID is retained in sessionStorage through a reload/lost ACK.
- A crash after intent creation or an uncertain send remains `PENDING`; do not
  interpret this as delivery or automatically resend. `SENT` means Auth
  accepted the request, **not proof of inbox delivery**. Failed/unknown outcomes
  are visible in support history; provider internals are not exposed.
- Reads use existing internal tables and `contract.transaction_log`. No new
  database grants, raw POS operational access, automatic financial writes,
  queue deletion, recovery deletion, or trial initialization.

## Production inspection / remaining handoff

On 4 October the server Auth lookup returns `VERIFIED` for the specifically
approved New Hope owner. The previous missing-service-role diagnosis is no
longer current. Supabase has the exact HTTPS `/reset-password` and `/login`
redirects allowlisted. Custom Resend SMTP is configured; DKIM, sending MX and
SPF are verified. Its separate receiving-MX warning does not establish an
outbound reset failure. Provider acceptance is not inbox delivery.

The owner/admin has no verified MFA factor. Previously the global admin guard
only checked fixture subjects and the MFA UI offered a fabricated dashboard
session. This follow-up removes both bypasses: all subjects require `aal2`,
mutations require fresh MFA, and login offers real Supabase TOTP enrollment.
The user must enroll and enter the code themselves; no factor is enrolled by
QA and no password is set on their behalf. An expired reset verification now
opens MFA inside the support drawer, retaining the selected account/reason;
verification never automatically sends the queued action.

The user approved one real reset email to their own account. Real inbox/link
verification is pending that user-operated MFA handoff. The loopback fixture
and simulated SDK/provider tests are not evidence of production delivery.

## Canonical capacity and loading

- One account owns one subscription. All directory/detail/support projections
  use `accountSubscription`, without writes or trial initialization.
- Four businesses is not four licensed outlets. The inspected account has
  two active outlets, Pro's four included slots and four add-on slots: 2/8.
  Both pages expose registered business count separately from used/capacity.
- Free retains historical outlet rows but licenses only the owner's selected
  outlet; inactive historical entries remain recoverable and use no slot.
- Admin sections are lazy-loaded; payment reconciliation loads only when
  opened. Search is debounced, identical in-flight GETs reuse the existing
  coordinator with exact session-token isolation, and owner Auth lookup runs
  alongside independent detail DB queries. No second state/cache system.

## Verification

- `npm run test:client-support`: isolated real migrations + HTTP routes;
  anonymous/non-admin/Growth denial, justified Support reads, exact verified
  owner lookup, real UUID MFA/staleness/future denial, provider failure, cooldown,
  lost ACK/reload, no duplicate email, atomic audit rollback, untouched cash
  ledger and recovery rows, no trial creation, and existing `svc_internal` grants.
- Supabase SDK provider calls tested with simulated Auth responses only.
- `npm run test:admin-security`, `npm run test:subscriptions`, `npm run lint`,
  `npm run build` pass, including 4 businesses/2 active/8 capacity and Free
  selection parity. No real reset email/payment/customer mutation was tested.
- Loopback-only browser fixture: subscription/manual-tier/detail drawers,
  Escape/focus restoration, customer detail, support-note save/history,
  confirmation checkbox enabling reset, provider acceptance and audited outcome.
  Fixture entry and fake provider are not production Vite inputs.

Official recovery reference:
https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
