# New Hope – DOKU Checkout / QRIS activation (24 Oct 2026)

## Current production status

- Full Neon application and 45-day free trial are live.
- DOKU real payments are **OFF**. This branch is a preparation patch, **not** a production promotion or provider acceptance.
- Production Vercel variable-name audit did not show `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY`, `DOKU_API_URL`, or `DOKU_ALLOWED_CHANNELS` for production at audit time. The checkout flag was present, but the flag's value was not read.
- QRIS activation was instructed by DOKU support but its approval state has **not** been verified. DOKU Checkout availability does not prove QRIS activation.

## DOKU Back Office (authorized owner)

1. Open https://dashboard.doku.com/bo/developer/api-keys. Read the **production Brand Client ID**, not Business ID; keep the Secret Key in a restricted secret manager. Never paste secrets into chat, GitHub, screenshots, or public docs.
2. Under **Settings → Service → Tambah Layanan → QR Payment**, select QR Payment, save, and submit the business name and correct MCC for New Hope's **software / subscription services** as directed by DOKU. Do **not** use a photography/restaurant MCC. DOKU must confirm the actual merchant-facing name, category, and QRIS state.
3. Open https://dashboard.doku.com/bo/configuration/checkout-page-v2 and check the **QRIS** tab only **after** QRIS has been activated. Support says the fields will auto-populate; treat this as a provider assertion until seen in the account.
4. Set the Notification URL for the enabled Checkout/payment channel(s) to:

    `https://kasir.newhope.space/api/v1/webhooks/doku`

   This must be a public HTTPS POST destination, without Basic Auth, Vercel protection, VPN, or redirect. **DOKU authenticates with signature headers**; application user login is not required. Follow any channel-specific notification configuration under Settings. The human-facing browser GET/405 response does not prove a signed POST works.
5. Review the notification history/delivery or provider test: matching Request-Id, correct signature, valid order and amount, timely **2xx** after persistence. The handler verifies raw bytes, digest, client ID, timestamp and HMAC; duplicates do not double-activate. Signed `FAILED` in Checkout does not revoke a successful/ongoing payment intent.

Official refs:
- https://developers.doku.com/get-started-with-doku-api/notification/setup-notification-url
- https://developers.doku.com/get-started-with-doku-api/notification/best-practice
- https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration
- https://developers.doku.com/accept-payments/doku-checkout/integration-guide/simulate-payment-and-notification

## App runtime / Vercel – staged steps, never switch while unverified

Introduce production secrets via Vercel's encrypted environment settings only, not repo files:

| Name | Candidate production value |
| --- | --- |
| `DOKU_CLIENT_ID` | **Real** production Brand Client ID from DOKU |
| `DOKU_SECRET_KEY` | **Real** production secret, hidden |
| `DOKU_API_URL` | `https://api.doku.com` |
| `DOKU_ALLOWED_CHANNELS` | `QRIS` (**only** while QRIS is the reviewed sole channel) |
| `DOKU_ACTIVATION_APPROVED` | `0` until signed notification, provider/owner acceptance and release evidence |
| `DOKU_PAYMENTS_ENABLED` | `0` until the same release acceptance |
| `PUBLIC_APP_URL` | `https://kasir.newhope.space` |

Changes to production env require a **new verified immutable Vercel deployment**. The currently running code rejects any `DOKU_PAYMENTS_ENABLED=1` through the Full Neon guard. This patch allows it only when ALL of the following are true: target=production, `DOKU_ACTIVATION_APPROVED=1`, official production API URL, valid Brand Client ID and nonblank Secret Key, exactly QRIS channel, and exact public origin. It never enables billing by default. Sandbox exercises must remain separate and cannot activate production payments.

## Acceptance gates

- [ ] QRIS activation shown active and provider merchant name / MCC reviewed (dashboard/provider evidence)
- [ ] Production Brand Client ID (not Business ID) and secret configured privately
- [ ] Verified signed webhook to public HTTPS endpoint using **sandbox first** and provider-supported final acceptance
- [ ] Checkout URL generated for an approved IDR quote; **only QRIS** selectable; customer redirect is NOT proof of settlement
- [ ] Duplicate, tampered signature, wrong amount/currency/channel, expired event, replay, and failed/cancelled states do not activate subscription
- [ ] Valid `SUCCESS` activates the quoted subscription once; invoice payment event and ledger match, no cross-tenant access
- [ ] Provider inquiry agrees with signed webhook, reconciliation `REVIEW` alerts tested
- [ ] Full CI and PostgreSQL rehearsal pass for exact commit; immutable candidate smoke verified
- [ ] Owner explicitly authorizes real-payment switch and controlled low-value final acceptance, including refund/settlement protocol
- [ ] Only then set both acceptance gate and payment flag to `1` on the reviewed release and promote it

Do not use a fabricated payment or test webhook to mark a real transaction `PAID`. Do not copy Supabase credentials or rollback a Neon production with user data back to Supabase. Maintain the working trial while DOKU is prepared.
