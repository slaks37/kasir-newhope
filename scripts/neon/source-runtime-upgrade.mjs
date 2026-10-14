import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import {loadBackup,restoreTarget,relation,sha} from './backup-common.mjs';
const {snapshot:s}=await loadBackup(),{env,manifest,...config}=restoreTarget();
const c=new pg.Client(config),file='neon/migrations/0008_restored_runtime_compat.sql',sql=fs.readFileSync(file,'utf8');
const evidence={status:'RUNNING',scope:'Explicit additive actual-source runtime compatibility upgrade; no source/production writes',targetBranch:env.NEON_BRANCH_ID,migration:file,migrationSha256:sha(sql),startedAt:new Date().toISOString(),checks:{}};
async function fingerprint(){const result=[];for(const t of s.tables){const r=(await c.query("SELECT count(*)::int rows,encode(extensions.digest(coalesce(string_agg(h,'|' ORDER BY h),''),'sha256'),'hex') fingerprint FROM(SELECT encode(extensions.digest(to_jsonb(t)::text,'sha256'),'hex') h FROM "+relation(t)+' t) x')).rows[0];result.push({schema:t.schema,name:t.name,...r});}return result;}
await c.connect();try{
 assert(c.connection.stream.encrypted&&c.connection.stream.authorized);
 await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='90s'; SET LOCAL lock_timeout='5s'");
 const before=await fingerprint();
 const walletsBefore=(await c.query("SELECT count(*)::int n,encode(extensions.digest(coalesce(string_agg(to_jsonb(w)::text,'|' ORDER BY w.merchant_id),''),'sha256'),'hex') fingerprint FROM ai.merchant_ai_credits w")).rows[0];
 await c.query(sql);
 const after=await fingerprint();assert.deepEqual(after,before,'All preexisting application rows/columns must remain unchanged');
 const walletsAfter=(await c.query("SELECT count(*)::int n,encode(extensions.digest(coalesce(string_agg(to_jsonb(w)::text,'|' ORDER BY w.merchant_id),''),'sha256'),'hex') fingerprint FROM ai.merchant_ai_credits w")).rows[0];assert.deepEqual(walletsAfter,walletsBefore);
 const derived=(await c.query("SELECT (SELECT count(*)::int FROM ai.credit_ledger WHERE entry_type='MIGRATION_OPENING') openingEntries,(SELECT count(*)::int FROM ai.credit_ledger_reconciliation WHERE difference<>0) walletDifferences,(SELECT count(*)::int FROM pos.shared_state_versions) sharedVersions,(SELECT count(*)::int FROM(SELECT DISTINCT tenant_id,coalesce(merchant_id,'00000000-0000-0000-0000-000000000000'::uuid),scope,kind FROM pos.shared_state_records) g) expectedSharedVersions,(SELECT count(*)::int FROM pos.staff_attendances) attendanceRows,(SELECT count(*)::int FROM pos.staff_payrolls) payrollRows")).rows[0];
 assert.equal(derived.walletdifferences,0);assert.equal(derived.openingentries,walletsBefore.n);assert.equal(derived.sharedversions,derived.expectedsharedversions);assert.equal(derived.attendancerows,0);assert.equal(derived.payrollrows,0);
 // Prove reapply doesn't grant another allowance, double an opening or change
 // originals. All assertions remain inside the same atomic DDL transaction.
 const ledgerBefore=(await c.query("SELECT encode(extensions.digest(coalesce(string_agg(to_jsonb(l)::text,'|' ORDER BY l.id),''),'sha256'),'hex') fingerprint FROM ai.credit_ledger l")).rows[0].fingerprint;
 await c.query(sql);
 const ledgerAfter=(await c.query("SELECT encode(extensions.digest(coalesce(string_agg(to_jsonb(l)::text,'|' ORDER BY l.id),''),'sha256'),'hex') fingerprint FROM ai.credit_ledger l")).rows[0].fingerprint;
 assert.equal(ledgerAfter,ledgerBefore);assert.deepEqual(await fingerprint(),before);
 evidence.checks={allOriginalTablesUnchanged:{tables:before.length,beforeFingerprint:sha(JSON.stringify(before)),afterFingerprint:sha(JSON.stringify(after))},walletsUnchanged:{rows:walletsBefore.n,fingerprint:walletsBefore.fingerprint},derived,idempotentReapply:true,noPeriodReset:true,noHistoricalCreditSpendInvented:true};
 await c.query('COMMIT');evidence.status='PASS';console.log(JSON.stringify({status:'PASS',originalTablesUnchanged:before.length,walletRowsUnchanged:walletsBefore.n,derived,idempotentReapply:true}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});evidence.status='FAIL';evidence.failure=e.message;throw Error(e.message);}finally{await c.end();evidence.finishedAt=new Date().toISOString();fs.writeFileSync('build/neon/source-runtime-upgrade-evidence.json',JSON.stringify(evidence,null,2)+'\n');}
