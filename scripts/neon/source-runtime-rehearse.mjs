import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import {parse} from 'dotenv';
import {restoreTarget,privateFile,sha} from './backup-common.mjs';
const {env,manifest}=restoreTarget(),roles=parse(privateFile('.env.neon-runtime-roles.local'));
if(roles.NEON_PROJECT_ID!==env.NEON_PROJECT_ID||roles.NEON_BRANCH_ID!==env.NEON_BRANCH_ID)throw Error('RUNTIME_REHEARSAL_TARGET_MISMATCH');
const url=new URL(roles.DATABASE_URL||'');url.hostname=url.hostname.replace('-pooler','');
if(url.hostname!==manifest.host||url.pathname!=='/neondb'||decodeURIComponent(url.username)!=='newhope_runtime_login')throw Error('ACTUAL_RUNTIME_LOGIN_REQUIRED');
for(const key of ['sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat'])url.searchParams.delete(key);
const c=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000});
const evidence={status:'RUNNING',scope:'Actual restricted LOGIN role; all mutations rolled back; no source/provider/email calls',targetBranch:env.NEON_BRANCH_ID,startedAt:new Date().toISOString(),checks:{}};
let beforeWallets,beforeState;
const fp=rows=>sha(rows.map(r=>r.data).sort().join('\n'));
async function wallets(){return(await c.query('SELECT to_jsonb(w)::text data FROM ai.merchant_ai_credits w')).rows;}
async function state(){return(await c.query('SELECT to_jsonb(r)::text data FROM pos.shared_state_records r')).rows;}
async function denied(sql,args,code){await c.query('SAVEPOINT rejection');let error;try{await c.query(sql,args)}catch(e){error=e}finally{await c.query('ROLLBACK TO SAVEPOINT rejection');await c.query('RELEASE SAVEPOINT rejection')}assert(error,'Expected denial');assert.equal(error.code,code);}
await c.connect();try{
 assert(c.connection.stream.authorized&&c.connection.stream.encrypted);
 const privileges=(await c.query('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];assert.equal(privileges.current_user,'newhope_runtime_login');assert.equal(privileges.rolsuper,false);assert.equal(privileges.rolbypassrls,false);
 beforeWallets=await wallets();beforeState=await state();
 await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s'");
 const wallet=(await c.query('SELECT merchant_id,balance,used_this_month,period_reset_at FROM ai.merchant_ai_credits WHERE balance>=1 ORDER BY merchant_id LIMIT 1 FOR UPDATE')).rows[0];assert(wallet,'Positive fixture/source wallet needed for rollback rehearsal');
 await c.query("SELECT set_config('app.ai_credit_ledger_reference','REHEARSAL_ROLLBACK_CONSUMPTION',true)");
 await c.query('UPDATE ai.merchant_ai_credits SET balance=balance-1,used_this_month=used_this_month+1 WHERE merchant_id=$1',[wallet.merchant_id]);
 let r=(await c.query("SELECT delta,entry_type FROM ai.credit_ledger WHERE merchant_id=$1 AND reference='REHEARSAL_ROLLBACK_CONSUMPTION'",[wallet.merchant_id])).rows;assert.deepEqual(r,[{delta:-1,entry_type:'CONSUMPTION'}]);
 await c.query('SELECT ai.add_ai_credit($1,5,$2)',[wallet.merchant_id,'REHEARSAL_ROLLBACK_TOPUP']);
 r=(await c.query("SELECT delta,entry_type FROM ai.credit_ledger WHERE merchant_id=$1 AND reference='REHEARSAL_ROLLBACK_TOPUP'",[wallet.merchant_id])).rows;assert.deepEqual(r,[{delta:5,entry_type:'TOPUP'}]);
 await c.query("SELECT set_config('app.ai_credit_ledger_type','REFUND',true),set_config('app.ai_credit_ledger_reference','REHEARSAL_ROLLBACK_REFUND',true)");
 await c.query('UPDATE ai.merchant_ai_credits SET balance=balance+1,used_this_month=greatest(0,used_this_month-1) WHERE merchant_id=$1',[wallet.merchant_id]);
 r=(await c.query("SELECT delta,entry_type FROM ai.credit_ledger WHERE merchant_id=$1 AND reference='REHEARSAL_ROLLBACK_REFUND'",[wallet.merchant_id])).rows;assert.deepEqual(r,[{delta:1,entry_type:'REFUND'}]);
 assert.equal((await c.query('SELECT difference FROM ai.credit_ledger_reconciliation WHERE merchant_id=$1',[wallet.merchant_id])).rows[0].difference,0);
 await denied('INSERT INTO ai.credit_ledger(merchant_id,delta,entry_type) VALUES($1,100,$2)',[wallet.merchant_id,'TOPUP'],'42501');
 await denied('UPDATE ai.credit_ledger SET delta=delta+1 WHERE merchant_id=$1',[wallet.merchant_id],'42501');
 await denied('DELETE FROM ai.credit_ledger WHERE merchant_id=$1',[wallet.merchant_id],'42501');
 await denied('SELECT ai.add_ai_credit($1,-5,$2)',[wallet.merchant_id,'NEGATIVE_TEST'],'P0001');
 await c.query("SELECT set_config('app.ai_credit_ledger_type','MIGRATION_OPENING',true)");
 await denied('UPDATE ai.merchant_ai_credits SET balance=balance+100 WHERE merchant_id=$1',[wallet.merchant_id],'P0001');
 evidence.checks.aiWallet={status:'PASS',consumptionLogged:true,topupLogged:true,refundLogged:true,reconciliationDifference:0,directLedgerInsertUpdateDeleteDenied:true,negativeTopupDenied:true,migrationOpeningTypeCannotBeForged:true};
 const record=(await c.query('SELECT tenant_id,merchant_id,scope,kind,record_id FROM pos.shared_state_records ORDER BY tenant_id,scope,kind,record_id LIMIT 1 FOR UPDATE')).rows[0];assert(record);
 const params=[record.tenant_id,record.merchant_id||'00000000-0000-0000-0000-000000000000',record.scope,record.kind];
 const version=Number((await c.query('SELECT version FROM pos.shared_state_versions WHERE tenant_id=$1 AND merchant_key=$2 AND scope=$3 AND kind=$4',params)).rows[0].version);
 await c.query('UPDATE pos.shared_state_records SET revision=revision+1 WHERE tenant_id=$1 AND scope=$2 AND kind=$3 AND record_id=$4',[record.tenant_id,record.scope,record.kind,record.record_id]);
 const bumped=Number((await c.query('SELECT version FROM pos.shared_state_versions WHERE tenant_id=$1 AND merchant_key=$2 AND scope=$3 AND kind=$4',params)).rows[0].version);assert.equal(bumped,version+1);
 evidence.checks.sharedVersionTrigger={status:'PASS',actualRuntimeMutation:true,versionIncrementExactlyOne:true};
 await c.query('ROLLBACK');
 assert.equal(fp(await wallets()),fp(beforeWallets),'All wallets unchanged after rollback');assert.equal(fp(await state()),fp(beforeState),'All shared records unchanged after rollback');
 const persisted=(await c.query("SELECT count(*)::int n FROM ai.credit_ledger WHERE reference LIKE 'REHEARSAL_ROLLBACK_%'")).rows[0].n;assert.equal(persisted,0);
 evidence.checks.rollback={status:'PASS',walletsFingerprint:fp(beforeWallets),sharedStateFingerprint:fp(beforeState),persistedTestLedgerEntries:0};evidence.status='PASS';console.log(JSON.stringify({status:'PASS',checks:evidence.checks.aiWallet,sharedVersionTrigger:evidence.checks.sharedVersionTrigger,allTestWritesRolledBack:true}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});evidence.status='FAIL';evidence.failure=e.message;throw Error(e.message);}finally{await c.end();evidence.finishedAt=new Date().toISOString();fs.writeFileSync('build/neon/source-runtime-rehearsal-evidence.json',JSON.stringify(evidence,null,2)+'\n');}
