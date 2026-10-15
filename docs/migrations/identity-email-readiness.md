# Auth email and HTTPS staging acceptance

No real email has been sent by the identity migration work. Recipient send
authorization is a separate final action, even if an address is a support contact.

Read-only Resend check on 2026-10-13 UTC: `kasir.newhope.space` has outbound sending
enabled with DKIM, sender MX and SPF TXT records **verified**. Its domain summary
is `partially_failed` because the receiving MX is failed. Inbound receiving is
independent of sending verification. Do not alter the website A/CNAME records or
other applications' verified domains to fix this summary. Open/click tracking is
disabled. The sending service region is Tokyo; the DB region is Singapore.

Required preview-only configuration (save through the secret store, not Git):

```dotenv
AUTH_EMAIL_ENABLED=1
AUTH_EMAIL_FROM=New Hope POS <auth@kasir.newhope.space>
AUTH_EMAIL_VERIFIED_DOMAIN=kasir.newhope.space
AUTH_EMAIL_ALLOWED_RECIPIENTS=stefen@newsystem.space
RESEND_API_KEY=<owner-configured sending key scoped to this domain>
VERCEL_ENV=preview
BETTER_AUTH_URL=<exact approved HTTPS canonical staging origin>
VITE_BETTER_AUTH_URL=<same canonical staging origin>
VITE_BETTER_AUTH_ALLOWED_ORIGINS=<explicit comma-separated approved POS/admin origins>
```

Run `node --import tsx scripts/neon/email-preflight.ts --env PRIVATE_STAGING_ENV`
for local read-only prerequisite checks. It reports booleans and emits no secret
values or email. A green preflight still requires owner-approved actual delivery.

`AUTH_EMAIL_ALLOWED_RECIPIENTS` blocks all other staging recipients. The support
address is proposed as the test mailbox because the owner supplied it; it is not
yet permission to send. Auth links use the canonical approved origin and native
verify/reset endpoints only. No callback token is logged, included in an
idempotency key or sent to an analytics endpoint. Templates are Indonesian,
include a 15-minute expiry, support contact and the unrequested-email instruction.
Delivery failure is not represented as successful delivery. Resend accepting an
API request is not evidence that the recipient received it.

After the HTTPS preview and secrets are ready, ask the owner to authorize this
exact test: one verification and one password-reset message to
`stefen@newsystem.space`, from `New Hope POS <auth@kasir.newhope.space>`.
The owner completes both links and verifies inbox/spam delivery. Do not send a
customer batch or migration announcement as part of this test.

Record receipt evidence without URLs, tokens or contents: provider email ID,
accepted/delivered/bounced status, timestamps, preview deployment revision,
verified domain states, browser link completion status and old-session denial.
Replaying a spent link must fail; an expired link must fail; password reset must
revoke previously signed native sessions. Confirm Secure/HttpOnly cookies,
cross-origin rejection and same-origin API calls from each explicitly approved
POS/admin host. No wildcard trusted hosts or shared cookie domain is introduced.

For an unknown account, the request gives the same generic response and sends no
message. Imported suspended accounts remain unavailable; imported unverified
accounts require verification before app access. Native TOTP enrollment and
backup-code recovery need separate proof; a successful email reset does not
bypass platform MFA or financial authorization.

The test harness uses a direct injected mail sink in developer code; no production
environment flag or public field switches email delivery into a fake success.
The missing HTTPS/secret/owner delivery acceptance remains a production gate.

Primary references:
[Resend idempotency](https://resend.com/changelog/idempotency-keys) and
[Better Auth email/password](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/authentication/email-password.mdx).


## Latest pre-production packet

See [preproduction-2026-10-15.md](preproduction-2026-10-15.md) for the fresh
source candidate, current DNS/email/account findings, private identity review
boundary and open gates. [Independent recovery process](independent-backup-recovery.md)
provides the owner/operator packet. No backup acceptance, identity approval, real
email/MFA acceptance, source freeze or production cutover is established.
