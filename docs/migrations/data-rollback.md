# Source restore and cutover rollback

Production Supabase is unchanged. `br-curly-truth-aze21ktf` is an isolated restored
candidate, so present rollback is to leave production on Supabase and disable
candidate traffic; it does not require production data repair or deletion.
Preserve encrypted snapshot, public hashes, canonical import audit, media manifest
and actual negative authorization evidence for owner review.

## Atomic staging failures

The catalog restore uses one transaction. Its actual rejected attempts (audit
foreign key omission, extension search-path mismatch) rolled back schema and data
before the corrected transaction committed. A populated target is rejected;
never reset the original synthetic pilot or silently retry over restored tables.
A new future restore must use a newly provisioned empty isolated child and a
reviewed target manifest. No automated DROP/TRUNCATE/clean-reset procedure exists.

Each additive compatibility/identity/role/media change has independent evidence.
The explicit two-field historical PIN redaction is deliberately irreversible:
rollback must not put original operational PINs back into a candidate. Earlier
captures are owner-controlled superseded encrypted evidence, requiring a secure
retention/disposal decision. Source credential/reset and live authority are not
restored by matching customer emails.

## Before production's first target business write

1. Keep Supabase as the sole authoritative writer until candidate end-to-end
   checks pass, independent source backup is restorable, and owner schedules a
   freeze/maintenance window.
2. Freeze the original writer, n8n publication, POS sync acceptance, DOKU invoice
   creation/callback application, AI/credit jobs and batch/reminder jobs through
   reviewed existing maintenance controls. Preserve incoming callback/outbox
   payloads durably; do not discard retries or fabricate payment verification.
3. Capture/reconcile the final frozen source snapshot into a fresh candidate.
   Verify source/target tenant, outlet, transaction/item/payment/cash/refund,
   subscription/invoice, wallet, catalog, shared state and media totals/hashes.
4. Pin frontend/backend/auth/storage configuration and deploy candidate against
   its own HTTPS origins. Domain switch comes last, after all positive and
   negative tests. Do not automatically promote this rehearsal branch.
5. If checks fail **before target writes**, route the app and jobs back to the
   unchanged source, revoke/disable target sessions and restore source jobs once
   one writer is confirmed. No target business deltas then require replay.

## After any target write

A database-URL switch is not a safe rollback. First stop both writers and capture
all target changes since the cutover checkpoint, including new accounts/UUID
bindings, POS/offline events and receipts, refunds/void/approvals, cash/inventory
ledgers, paid terms, DOKU callback outcomes, AI usage/grants, consent/audit/privacy
records, articles/media and operational state.

- Reconcile and replay accepted target deltas into the source by the original
  immutable transaction/client/idempotency references. Compensating entries
  preserve finance history; do not update/delete an immutable ledger.
- Verify subscription amounts and periods and AI wallet differences before
  resuming any service. `MIGRATION_OPENING` entries are source-balance checkpoints,
  not new grants, and must not be granted again during rollback or a repeat move.
- Native Better Auth password-reset/MFA/session state cannot be blindly rewritten
  into Supabase auth. Revoke target sessions; a reviewed identity transition and
  owner/support communication is required. No live sessions or MFA grants are
  copied through this pipeline.
- Restore or reconcile object URLs using the verified copy manifest; keep both
  source and target media readable until reference rollback finishes.
- Reconcile buffered callbacks and offline queues before resuming a single
  authoritative writer; late replay must not double-charge, duplicate POS sales
  or infer QRIS verification from static amount matching.

A proven reverse-delta replay is still required before production cutover. This
runbook does not claim that a full live after-write reverse migration has been
executed. Supabase backup/PITR and separated durable key/ciphertext escrow remain
required because scoped catalog backups omit provider credentials/platform state.
Six-hour Neon retained history is not an independent backup.
