# Customer & Support (local implementation, 3 October 2026)

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

## Activation prerequisites / limitations

The initial support/reset implementation is deployed in production commit
`ce4cbe7` (3 October 2026). The confirmation-resend follow-up is local and
tested, not yet deployed. Production inspection on 4 October found custom
Resend SMTP enabled, but admin detail returns `NOT_CONFIGURED`: the Vercel
project has frontend Supabase URL/anon variables and no
`SUPABASE_SERVICE_ROLE_KEY`. SMTP readiness does not configure the application's
server Auth admin client. Before enabling real email reset:

- Confirm server Supabase URL/service-role credential configuration without
  exposing the credential in the frontend.
- Allowlist the exact production recovery URL in Supabase Auth redirect URLs.
- Allowlist `/login` on the production origin for confirmation resends. The
  follow-up distinguishes unconfirmed/missing/unavailable Auth accounts and
  uses Supabase `resend(type: signup)` only for the exact unconfirmed owner.
  It shares MFA, audit-before-send, two-minute cooldown, and replay protection;
  confirmation never sets `email_confirmed_at` or changes a password.
- Verify production SMTP/sender configuration and delivery with an approved
  test owner. Default Auth email limitations are not evidence of production
  SMTP readiness.
- Admin must enroll/verify an authenticator. The preexisting global admin MFA
  rollout limitation remains documented in `docs/architecture/workspace-refactor.md`;
  this feature independently enforces MFA for **every password reset**.

## Verification

- `npm run test:client-support`: isolated real migrations + HTTP routes;
  anonymous/non-admin/Growth denial, justified Support reads, exact verified
  owner lookup, real UUID MFA/staleness/future denial, provider failure, cooldown,
  lost ACK/reload, no duplicate email, atomic audit rollback, untouched cash
  ledger and recovery rows, no trial creation, and existing `svc_internal` grants.
- Supabase SDK provider calls tested with simulated Auth responses only.
- `npm run test:admin-security`, `npm run test:subscriptions`, `npm run lint`,
  `npm run build` pass. No real reset email/payment/customer mutation was tested.
- Loopback-only browser fixture: subscription/manual-tier/detail drawers,
  Escape/focus restoration, customer detail, support-note save/history.
  Fixture entry and fake provider are not production Vite inputs.

Official recovery reference:
https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
