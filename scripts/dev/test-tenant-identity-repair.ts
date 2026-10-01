// No cloud or Auth calls: exercise identity reconciliation on isolated PostgreSQL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {tenantForPrincipal} from '../../services/shared/auth';
const pg=new PGlite();
await pg.exec('CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;');
const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql'&&Number(f.slice(0,4))<=50).sort().map(f=>'migrations/'+f)];
for(const file of files)await pg.exec(fs.readFileSync(file,'utf8'));
await pg.exec("INSERT INTO billing.plans(id,name,tier_level,price_idr) VALUES('plan-free','Trial',1,0),('plan-plus-monthly','Plus',2,99000) ON CONFLICT DO NOTHING");
async function fixture(paid:boolean){
  const owner=randomUUID(),old=randomUUID(),canonical=randomUUID(),merchant=randomUUID(),outlet=randomUUID(),oldOutlet=randomUUID(),membership=randomUUID();
  await pg.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Owner')",[owner,owner+'@test.invalid']);
  await pg.query("INSERT INTO internal.tenants(id,name,owner_user_ref,external_ref) VALUES($1,'Same business',$3,null),($2,'Same business',$3,$3)",[old,canonical,owner]);
  await pg.query("INSERT INTO pos.tenants(id,name,owner_user_ref) VALUES($1,'Same business',$2)",[old,owner]);
  await pg.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$1,'Same business','RETAIL',null),($2,$3,'Same business','RETAIL',$4)",[old,merchant,canonical,owner+'_RETAIL']);
  await pg.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$2,'Legacy'),($3,$4,$5,'Current')",[oldOutlet,old,outlet,canonical,merchant]);
  await pg.query("INSERT INTO internal.memberships(id,user_id,tenant_id,merchant_id,role,pin) VALUES($1,$2,$3,$3,'OWNER','original-pin')",[membership,owner,old]);
  await pg.query("INSERT INTO ai.merchant_ai_credits(merchant_id,tenant_id,balance,monthly_grant,used_this_month) VALUES($1,$1,17,30,13)",[old]);
  await pg.query("INSERT INTO billing.subscriptions(id,tenant_id,plan_id,status,current_period_start,current_period_end,trial_started_at,trial_ends_at) VALUES($1,$2,'plan-free','TRIAL',now(),now()+interval '45 days',now(),now()+interval '45 days')",[randomUUID(),old]);
  if(paid)await pg.query("INSERT INTO billing.subscriptions(id,tenant_id,plan_id,status,billing_cycle,extra_outlets,recurring_amount,current_period_start,current_period_end) VALUES($1,$2,'plan-plus-monthly','ACTIVE','YEARLY',1,1000000,now(),now()+interval '1 year')",[randomUUID(),canonical]);
  return {owner,old,canonical,merchant,outlet,oldOutlet,membership};
}
const trial=await fixture(false),paid=await fixture(true);
const paidBefore=(await pg.query('SELECT * FROM billing.subscriptions WHERE tenant_id=$1',[paid.canonical])).rows[0];
const trialBefore=(await pg.query('SELECT * FROM billing.subscriptions WHERE tenant_id=$1',[trial.old])).rows[0] as any;
// An unrelated real ledger row must remain exactly unchanged.
await pg.query("INSERT INTO pos.users(id,tenant_id,name,username,pin) VALUES($1,$2,'Cashier','cashier','protected')",[paid.owner,paid.canonical]);
await pg.query("INSERT INTO pos.transactions(id,tenant_id,merchant_id,outlet_id,cashier_user_id,subtotal,total_amount,payment_method,business_sector) VALUES($1,$2,$3,$4,$5,12345,12345,'CASH','RETAIL')",[randomUUID(),paid.canonical,paid.merchant,paid.outlet,paid.owner]);
const ledgerBefore=JSON.stringify((await pg.query('SELECT * FROM pos.transactions')).rows);
const repair=fs.readFileSync('migrations/0051_reconcile_duplicate_owner_identity.sql','utf8');
await pg.transaction(async tx=>{await tx.exec(repair);});
assert.equal(JSON.stringify((await pg.query('SELECT * FROM pos.transactions')).rows),ledgerBefore);
assert.deepEqual((await pg.query('SELECT * FROM billing.subscriptions WHERE tenant_id=$1',[paid.canonical])).rows[0],paidBefore,'Paid access, amount and term remain unchanged');
const trialAfter=(await pg.query('SELECT * FROM billing.subscriptions WHERE tenant_id=$1',[trial.canonical])).rows[0] as any;
assert.equal(trialAfter.id,trialBefore.id);assert.equal(String(trialAfter.current_period_end),String(trialBefore.current_period_end),'No trial reset');
for(const row of [trial,paid]){
  const source=(await pg.query('SELECT merged_into,is_active FROM internal.tenants WHERE id=$1',[row.old])).rows[0] as any;
  assert.equal(source.merged_into,row.canonical);assert.equal(source.is_active,false);
  const member=(await pg.query('SELECT tenant_id,merchant_id,pin,role FROM internal.memberships WHERE id=$1',[row.membership])).rows[0] as any;
  assert.equal(member.tenant_id,row.canonical);assert.equal(member.merchant_id,row.merchant);assert.equal(member.pin,'original-pin');assert.equal(member.role,'OWNER');
  const wallet=(await pg.query('SELECT balance,used_this_month FROM ai.merchant_ai_credits WHERE merchant_id=$1',[row.canonical])).rows[0] as any;
  assert.equal(Number(wallet.balance),17);assert.equal(wallet.used_this_month,13);
  const db={query:async(s:string,p?:unknown[])=>{const r=await pg.query(s,p);return {rows:r.rows,rowCount:r.rows.length};}} as any;
  assert.equal(await tenantForPrincipal(db,{subject:row.owner}),row.canonical);
  assert.equal((await pg.query('SELECT * FROM contract.merchant_directory WHERE tenant_id=$1',[row.canonical])).rows.length,1);
  assert.equal((await pg.query('SELECT * FROM contract.merchant_directory WHERE tenant_id=$1',[row.old])).rows.length,0);
}
assert.equal((await pg.query('SELECT * FROM internal.tenant_identity_recovery')).rows.length,2);
await pg.transaction(async tx=>{await tx.exec(repair);});assert.equal((await pg.query('SELECT * FROM internal.tenant_identity_recovery')).rows.length,2,'Repair is idempotent');
await assert.rejects(()=>pg.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Duplicate',$2)",[randomUUID(),trial.owner]),/uq_tenant_canonical_owner/);
for(const role of ['anon','authenticated'])await assert.rejects(()=>pg.transaction(async tx=>{await tx.exec('SET LOCAL ROLE '+role);await tx.query('SELECT * FROM internal.tenant_identity_recovery');}),/permission denied/);
// Removing the index simulates an older database; a source with operational data is never silently archived.
await pg.exec('DROP INDEX internal.uq_tenant_canonical_owner');
const guarded=await fixture(false);
await pg.query("INSERT INTO pos.shared_state_records(tenant_id,merchant_id,scope,kind,record_id,value,revision) VALUES($1,$1,'RETAIL','tables','valuable-local', '{}'::jsonb,1)",[guarded.old]);
await assert.rejects(()=>pg.transaction(async tx=>{await tx.exec(repair);}),/REQUIRES_MANUAL_REVIEW/);
assert.equal((await pg.query('SELECT merged_into FROM internal.tenants WHERE id=$1',[guarded.old])).rows[0].merged_into,null);
assert.equal((await pg.query('SELECT * FROM pos.shared_state_records WHERE tenant_id=$1',[guarded.old])).rows.length,1);
await pg.query('DELETE FROM pos.shared_state_records WHERE tenant_id=$1',[guarded.old]);
await pg.query("INSERT INTO pos.users(id,tenant_id,name,username,pin) VALUES($1,$2,'Owner','owner','original')",[guarded.owner,guarded.old]);
await pg.query("INSERT INTO pos.transactions(id,tenant_id,merchant_id,outlet_id,cashier_user_id,subtotal,total_amount,payment_method,business_sector) VALUES($1,$2,$2,$3,$4,54321,54321,'CASH','RETAIL')",[randomUUID(),guarded.old,guarded.oldOutlet,guarded.owner]);
const sourceLedger=JSON.stringify((await pg.query('SELECT * FROM pos.transactions ORDER BY id')).rows);
await assert.rejects(()=>pg.transaction(async tx=>{await tx.exec(repair);}),/REQUIRES_MANUAL_REVIEW/);
assert.equal(JSON.stringify((await pg.query('SELECT * FROM pos.transactions ORDER BY id')).rows),sourceLedger,'A source with financial history is never automatically merged');
await pg.close();console.log('PASS: duplicate identity archive, paid term/trial date/wallet/member preservation, ledger unchanged, private backup, idempotency and guarded rollback');
