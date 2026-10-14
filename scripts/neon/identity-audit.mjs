import fs from 'node:fs';
import pg from 'pg';
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
process.env.NEON_STAGING_ENV_FILE=arg('--env')||'.env.better-auth-restore.local';
const {stagingTarget,projectId,branchId}=await import('./better-target.mjs');
const {env,...transport}=stagingTarget();const c=new pg.Client(transport);
try {
  await c.connect();if(!c.connection.stream.encrypted||!c.connection.stream.authorized)throw Error('IDENTITY_TLS_REQUIRED');
  const batches=(await c.query(`SELECT b.id AS batch_id,b.source_project,b.source_digest,b.source_backup_ref,b.reviewer_ref,b.issuer,b.row_count,b.business_digest,b.created_at,
    (SELECT count(*)::int FROM newhope_auth.identity_import_canonical_creates x WHERE x.batch_id=b.id) AS explicit_canonical_creates,
    EXISTS(SELECT 1 FROM newhope_auth.identity_import_revocations r WHERE r.batch_id=b.id) AS revoked
    FROM newhope_auth.identity_import_batches b ORDER BY b.created_at`)).rows;
  const totals=(await c.query(`SELECT
    (SELECT count(*)::int FROM newhope_auth."user") AS native_users,
    (SELECT count(*)::int FROM newhope_auth."user" WHERE "emailVerified") AS verified_native_users,
    (SELECT count(*)::int FROM newhope_auth.account WHERE "providerId"='credential') AS native_credentials,
    (SELECT count(*)::int FROM newhope_auth.session) AS native_sessions,
    (SELECT count(*)::int FROM newhope_auth."twoFactor" WHERE verified) AS enrolled_native_totp,
    (SELECT count(*)::int FROM internal.auth_identity_bindings WHERE provider='better-auth' AND is_active) AS active_canonical_bindings`)).rows[0];
  const evidence={checkedAt:new Date().toISOString(),projectId,branchId,scope:'Read-only sanitized import audit; no account addresses, names, credential hashes, sessions, reset links or MFA secrets',reviewSemantics:'Technical agent review under general owner migration-preparation authorization; exact final account mapping/cutover approval is not established by reviewer_ref',batches,totals};
  fs.writeFileSync(arg('--out')||'build/neon/identity-audit-summary.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
}finally {await c.end();}
