import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Db} from '../../services/shared/db';
import {assertStagingGrantConnection,stagingModuleGrantSql,stagingModuleGrantRequest,stagingGrantTarget} from '../release/staging-module-grant';

/** Synthetic DB evidence only. Invoked on PGlite and actual PostgreSQL 17/18. */
export async function stagingGrantAcceptance(db:Db){
 const owner=randomUUID(),tenant=randomUUID(),merchant=randomUUID(),outlet=randomUUID();
 await db.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Synthetic QA owner')",[owner,owner+'@fixture.invalid']);
 await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Synthetic QA tenant',$2)",[tenant,owner]);
 await db.query("INSERT INTO billing.subscriptions(tenant_id,plan_id,status,current_period_start,current_period_end) VALUES($1,'plan-free','TRIAL',now(),now()+interval '10 days')",[tenant]);
 await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector) VALUES($1,$2,'QA Staging synthetic grant','RETAIL')",[merchant,tenant]);
 await db.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$3,'QA synthetic outlet')",[outlet,tenant,merchant]);
 const input={ownerId:owner,tenantId:tenant,merchantId:merchant,outletId:outlet,reference:'pr35-qa-synthetic-grant',expiresAt:new Date(Date.now()+86400000).toISOString()};
 assert.equal(stagingModuleGrantRequest(input).branch_id,stagingGrantTarget.branchId);
 assert.throws(()=>stagingModuleGrantRequest(input,'0'.repeat(64)),/STAGING_REVIEW_DIGEST_MISMATCH/);
 const counts=async()=> (await db.query('SELECT (SELECT count(*)::int FROM internal.merchant_modules WHERE merchant_id=$1) AS assignments,(SELECT count(*)::int FROM billing.module_entitlements WHERE merchant_id=$1) AS entitlements,(SELECT count(*)::int FROM internal.audit_logs WHERE merchant_id=$1) AS events',[merchant])).rows[0];
 await db.exec(stagingModuleGrantSql(input).sql);assert.deepEqual(await counts(),{assignments:0,entitlements:0,events:0},'Dry run cannot mutate');
 await assert.rejects(()=>db.exec(stagingModuleGrantSql({...input,ownerId:randomUUID()},true).sql),/STAGING_OWNER_MISMATCH/);
 await assert.rejects(()=>db.exec(stagingModuleGrantSql({...input,expiresAt:new Date(Date.now()+3*86400000).toISOString()},true).sql),/STAGING_EXPIRY_REJECTED/);
 await db.query("UPDATE billing.subscriptions SET status='EXPIRED' WHERE tenant_id=$1",[tenant]);
 await assert.rejects(()=>db.exec(stagingModuleGrantSql(input,true).sql),/VALID_TRIAL_OR_PAID_REQUIRED/);
 await db.query("UPDATE billing.subscriptions SET status='TRIAL' WHERE tenant_id=$1",[tenant]);
 const extras=[randomUUID(),randomUUID()];for(const id of extras)await db.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$3,'QA extra')",[id,tenant,merchant]);
 await assert.rejects(()=>db.exec(stagingModuleGrantSql(input,true).sql),/SINGLE_QA_OUTLET_REQUIRED/);
 for(const id of extras)await db.query('DELETE FROM internal.outlets WHERE id=$1',[id]);
 // Extra outlets in a sibling merchant still consume the tenant subscription.
 const sibling=randomUUID();await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector) VALUES($1,$2,'Synthetic sibling','FNB')",[sibling,tenant]);
 for(const id of extras)await db.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$3,'Sibling')",[id,tenant,sibling]);
 await assert.rejects(()=>db.exec(stagingModuleGrantSql(input,true).sql),/OUTLET_CAPACITY_EXCEEDED/);
 for(const id of extras)await db.query('DELETE FROM internal.outlets WHERE id=$1',[id]);
 await db.query("UPDATE internal.merchants SET name='Real business' WHERE id=$1",[merchant]);
 await assert.rejects(()=>db.exec(stagingModuleGrantSql(input,true).sql),/QA_MERCHANT_REQUIRED/);
 await db.query("UPDATE internal.merchants SET name='QA Staging synthetic grant' WHERE id=$1",[merchant]);
 await db.exec(stagingModuleGrantSql(input,true).sql);await db.exec(stagingModuleGrantSql(input,true).sql);
 assert.deepEqual(await counts(),{assignments:5,entitlements:5,events:1},'Replay never adds or extends entitlements or audit records');
 await assert.rejects(()=>db.exec(stagingModuleGrantSql({...input,expiresAt:new Date(Date.now()+85000000).toISOString()},true).sql),/STAGING_REFERENCE_REUSED/);
 await db.query("UPDATE billing.module_entitlements SET enabled=false WHERE merchant_id=$1 AND module_id='retail'",[merchant]);
 await assert.rejects(()=>db.exec(stagingModuleGrantSql(input,true).sql),/STAGING_GRANT_DRIFT/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM internal.outlets WHERE tenant_id=$1',[tenant])).rows[0].n,1);
 assert.equal((await db.query("SELECT status,plan_id FROM billing.subscriptions WHERE tenant_id=$1",[tenant])).rows[0].status,'TRIAL');
 assertStagingGrantConnection(`postgres://neondb_owner:synthetic@${stagingGrantTarget.host}/neondb?sslmode=verify-full`);
 for(const host of ['production.neon.tech','ep-gentle-silence-az2bwpz6.c-3.ap-southeast-1.aws.neon.tech',stagingGrantTarget.host+'-pooler'])assert.throws(()=>assertStagingGrantConnection(`postgres://neondb_owner:synthetic@${host}/neondb?sslmode=verify-full`),/STAGING_CONNECTION_REJECTED/);
 assert.throws(()=>assertStagingGrantConnection(`postgres://neondb_owner:synthetic@${stagingGrantTarget.host}/neondb?sslmode=verify-full&host=production.neon.tech`),/STAGING_CONNECTION_REJECTED/);
 return {dryRun:'PASS',idempotency:'PASS',ownerAndQaScope:'PASS',expiryAndSubscription:'PASS',capacity:'PASS',drift:'PASS',audit:'PASS',urlPin:'PASS'};
}
