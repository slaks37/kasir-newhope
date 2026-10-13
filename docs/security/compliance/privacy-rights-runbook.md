# Personal data rights procedure — draft requiring owner/counsel approval

## Intake and ownership

Authenticated owners use Settings → Privasi & Permintaan Data. `/api/v1/privacy/requests` binds the verified cloud subject to the canonical active owned tenant; browser tenant/actor claims are ignored. The owner may request ACCESS, CORRECTION, DELETION, EXPORT or CONSENT_WITHDRAWAL. Records are idempotent, limited to ten/day and private. They are intake, not an automatic export/delete mechanism.

A customer/staff member should contact their merchant controller or the public privacy channel. On 13 October 2026 the owner supplied operator **New System**, physical address **Graha Suryamas Blok K4**, and email **stefen@newsystem.space**. The legal pages use that email by default; `VITE_PUBLIC_PRIVACY_EMAIL` can override it with an approved address. Mailbox delivery, responsible team and response SLA still require operational verification before public launch; no test message was sent. Legal form/registration and the complete postal address including city/postcode remain owner/counsel verification items. A public applicant does not need a New Hope account to use the email channel. This task did not request identity documents.

Provider admin API: `GET /api/admin/privacy-requests?offset=0` (MFA/RBAC). Internal support additionally supplies `merchantId` and `justification`; reads and status updates are audited and filtered to that merchant's tenant. Review via `PUT /api/admin/privacy-requests/:id?merchantId=...` with status and a specific reason. Status change alone does not fulfil the rights request. Superadmin may enumerate the queue; support may not omit scope. Integrate this queue into the support operational rota before release; dedicated admin UI is a follow-up item.

## Verification and response

1. Acknowledge request ID, exact scope and responsible controller; apply current statutory deadlines verified by counsel (do not substitute this draft's proposed operational targets for law).
2. Verify requester identity/agency via existing confirmed account and appropriate step-up; merchant must verify authority for its customers/staff. Never request full NIK/card/password by initial email/message. Record method and outcome, not unnecessary document copies.
3. Find all relevant stores using the inventory: cloud, public legacy mirrors, offline devices/outboxes, storage, service logs and processors. Tenant/outlet scope is mandatory; include no other business's data. Record legal holds and statutory exceptions.
4. ACCESS/EXPORT: stage a minimum export scoped to verified subject and authorized merchant; exclude credentials, secrets, unrelated people and internal confidential controls. Deliver via authenticated retrieval or short-lived private signed link, audit who retrieved it, expire the artefact. Test using another tenant before delivery. No anonymous bulk export endpoint is introduced.
5. CORRECTION: record specific requested fields, controller approval and before/after evidence. Correct operational contact data; financial history uses documented adjustment/reversal, never silent overwrite.
6. DELETION: legal-hold review first. Separate optional profile/contact fields from required transaction/accounting/audit records. Review FK cascades and identities embedded in JSON, exports, receipt/media and offline caches. Pseudonymize/unlink where lawful; preserve minimum required records with restricted access and approved retention. Prepare dry-run counts, backup/tombstone plan and rollback before an explicit authorized mutation. Never delete Auth/tenant first if it cascades into financial data.
7. CONSENT_WITHDRAWAL: stop future optional external AI processing and record version/purpose/providers/actor/time; already transmitted data needs processor-specific assistance and cannot be represented as recalled. Core POS remains usable. Terms acceptance is not processing consent.
8. Mark IN_PROGRESS/COMPLETED only after evidence of actual fulfilment; explain scope, exceptions, retention and complaint route. DECLINED requires documented legal reason and appeal path. Close with reviewer and completion timestamp in immutable request events.

## Migration and rollback

Apply `20261012144654_privacy_request_workflow.sql` to staging after service role/dependency review. `0060_...` is its identical local bootstrap copy. Additive tables only; no existing RLS/grant revocation or operational data changes. New tables deny anon/authenticated; svc_pos has tenant-scoped SELECT/INSERT; svc_internal has workflow access behind MFA/RBAC, not unguarded public access. Verify actual direct DB role credentials before release.

Deploy schema before server/UI, configure public privacy email and approve notices/company details first. Failed workflow returns 503; do not say a request was received when not committed. Roll back UI/API exposure while keeping accepted requests, notice acknowledgements and audit; never DROP them or reenact unsafe destructive deletion. Before removal, export protected evidence and approve retention/hold procedures. No production migration/deletion was executed.

Signup notice uses explicit native form acknowledgement. Subscription records a versioned acknowledgement authenticated on the server; existing signup metadata is not represented as immutable proof of consent. Notice acknowledgements are separate from optional AI consent events. Verify signup, signup failure, trial, paid checkout, request replay, cross-tenant denial and support scope in staging.
