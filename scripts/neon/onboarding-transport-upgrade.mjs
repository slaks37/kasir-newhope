import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import {loadBackup,restoreTarget,sha} from './backup-common.mjs';
const {snapshot}=await loadBackup(),{env,manifest,...config}=restoreTarget();
const c=new pg.Client(config),file='neon/migrations/0009_native_onboarding_transport.sql',sql=fs.readFileSync(file,'utf8');
const evidence={status:'RUNNING',scope:'Isolated staging native-store transport repair; no source writes, identity activation or ownership changes',branchId:env.NEON_BRANCH_ID,migration:file,sha256:sha(sql),startedAt:new Date().toISOString(),checks:{}};
const sourceIds=snapshot.tables.find(t=>t.schema==='internal'&&t.name==='merchants').rows.map(r=>JSON.parse(r).id);
async function preserved(){const results=[];
 for(const table of ['internal.merchants','pos.transactions','pos.payments','pos.cash_ledger','billing.subscriptions','ai.merchant_ai_credits']){
  const filter=table==='internal.merchants'?' WHERE id::text=ANY($1::text[])':'';
  results.push({table,...(await c.query("SELECT count(*)::int rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) fingerprint FROM "+table+' t'+filter,filter?[sourceIds]:[])).rows[0]});
 }return results;
}
await c.connect();try{
 assert(c.connection.stream.encrypted&&c.connection.stream.authorized);await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
 const before=await preserved();
 const count=async()=>Number((await c.query('SELECT count(*) AS n FROM internal.merchants WHERE external_ref IS NOT NULL')).rows[0].n);
 const prior=await count();await c.query(sql);const after=await count();assert.deepEqual(await preserved(),before);
 const first=(await c.query("SELECT md5(string_agg(to_jsonb(m)::text,'|' ORDER BY id)) AS hash FROM internal.merchants m")).rows[0].hash;
 await c.query(sql);assert.equal((await c.query("SELECT md5(string_agg(to_jsonb(m)::text,'|' ORDER BY id)) AS hash FROM internal.merchants m")).rows[0].hash,first);
 evidence.checks={aliasesAdded:after-prior,idempotentReapply:true,sourceMerchantsAndFinancialRowsUnchanged:before};
 await c.query('COMMIT');evidence.status='PASS';console.log(JSON.stringify({status:evidence.status,branchId:env.NEON_BRANCH_ID,aliasesAdded:after-prior,sourceAndFinancialRowsUnchanged:true,idempotentReapply:true}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});evidence.status='FAIL';evidence.failure=e.code||e.message;throw e;}
finally{await c.end();evidence.finishedAt=new Date().toISOString();fs.writeFileSync('build/neon/onboarding-transport-evidence.json',JSON.stringify(evidence,null,2)+'\n');}
