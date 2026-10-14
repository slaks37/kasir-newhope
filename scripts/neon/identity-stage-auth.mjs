import fs from 'node:fs';
import {createHash} from 'node:crypto';
import pg from 'pg';
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
process.env.NEON_STAGING_ENV_FILE=arg('--env')||'.env.neon-data-restore.local';
const {stagingTarget,projectId,branchId}=await import('./better-target.mjs');
const reconcile=JSON.parse(fs.readFileSync('build/neon/source-reconciliation-evidence.json','utf8'));
if(reconcile.status!=='PASS'||reconcile.targetProject!==projectId||reconcile.targetBranch!==branchId)throw Error('IDENTITY_SOURCE_RECONCILIATION_REQUIRED');
const {env,...transport}=stagingTarget();const c=new pg.Client(transport);
const receipt={projectId,branchId,sourceBackupSha256:reconcile.ciphertextSha256,status:'PLAN_ONLY',scope:'Additive auth/identity schema only on reconciled isolated restored child',startedAt:new Date().toISOString(),files:[]};
try {
  await c.connect();if(!c.connection.stream.encrypted||!c.connection.stream.authorized)throw Error('IDENTITY_TLS_REQUIRED');
  const exists=async name=>(await c.query('SELECT to_regclass($1) AS object',[name])).rows[0].object;
  const files=[];
  if(!await exists('internal.auth_identity_bindings'))files.push('0001_identity_bindings.sql');
  if(!await exists('newhope_auth.user')) {
    const objects=(await c.query("SELECT count(*)::int AS n FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='newhope_auth'")).rows[0].n;
    if(objects)throw Error('IDENTITY_PARTIAL_AUTH_SCHEMA_REVIEW_REQUIRED');
    files.push('0002_better_auth_core.sql');
  }
  if(!await exists('newhope_auth.mfa_session_proofs'))files.push('0003_better_auth_evidence.sql');
  const check=(await c.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid=to_regclass('internal.auth_identity_bindings') AND conname='auth_identity_bindings_provider_check'")).rows[0]?.def;
  if(!check||!check.includes('better-auth'))files.push('0004_better_auth_identity_provider.sql');
  if(!await exists('newhope_auth.identity_import_batches'))files.push('0006_identity_import_audit.sql');
  if(!await exists('newhope_auth.identity_import_canonical_creates'))files.push('0007_identity_canonical_create_evidence.sql');
  for(const file of files){const sql=fs.readFileSync('neon/migrations/'+file,'utf8');receipt.files.push({file,sha256:createHash('sha256').update(sql).digest('hex')});}
  if(process.argv.includes('--apply')) {
    await c.query('BEGIN');
    try{for(const file of files)await c.query(fs.readFileSync('neon/migrations/'+file,'utf8'));await c.query('COMMIT');}
    catch(e){await c.query('ROLLBACK');throw e;}
    receipt.status=files.length?'APPLIED':'UNCHANGED';
    receipt.authUsers=(await c.query('SELECT count(*)::int AS n FROM newhope_auth."user"')).rows[0].n;
  }
  console.log(JSON.stringify(receipt));
}catch(e){receipt.status='FAILED';receipt.failure=/^IDENTITY_/.test(e.message)?e.message:'IDENTITY_AUTH_SCHEMA_OPERATION_FAILED';throw e;}
finally {await c.end();receipt.finishedAt=new Date().toISOString();fs.writeFileSync('build/neon/identity-auth-schema-receipt.json',JSON.stringify(receipt,null,2)+'\n');}
