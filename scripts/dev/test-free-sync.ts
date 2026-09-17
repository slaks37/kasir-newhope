import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Db } from '../../services/shared/db';
import { activateFreeTrial, ensureSubscription, subscriptionStatus } from '../../services/billing/engine';
import { resolveFreeSyncScope } from '../../services/billing/freePlan';
import express from 'express';
import { createSyncHandler } from '../../src/server/syncHandler';

/** Called against the isolated PGlite fixture, never production. */
export async function testFreeSync(db:Db,url:string) {
  const owner=randomUUID(),tenant=randomUUID(),merchant=randomUUID(),branch=randomUUID(),otherBranch=randomUUID();
  const syncApp=express();
  // Match serverless requests whose JSON stream was already consumed upstream.
  syncApp.use(express.json());
  syncApp.use(createSyncHandler(async req=>req.headers.authorization==='Bearer free-fixture'?{subject:owner}:null,async()=>db));
  const syncServer=syncApp.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>syncServer.once('listening',resolve));
  const syncUrl='http://127.0.0.1:'+(syncServer.address() as any).port;
  try {
  await db.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Free owner')",[owner,owner+'@test.invalid']);
  await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref,owner_user_id) VALUES($1,'Free fixture',$2::text,$2::uuid)",[tenant,owner]);
  await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector) VALUES($1,$2,'Free brand','FNB')",[merchant,tenant]);
  await db.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$3,$4,'Retained branch'),($2,$3,$4,'Selected branch')",[otherBranch,branch,tenant,merchant]);
  await ensureSubscription(db,tenant);
  await db.query("UPDATE billing.subscriptions SET current_period_end=now()-interval '1 day' WHERE tenant_id=$1",[tenant]);
  await assert.rejects(()=>resolveFreeSyncScope(db,owner,'FNB'),/FREE_SELECTION_REQUIRED/);
  const ids=Array.from({length:10},(_,i)=>'free-product-'+i);
  const selection={branchId:branch,sector:'FNB',productIds:ids};
  for(const invalid of [{productIds:[]},{...selection,productIds:[...ids,'eleven']},{...selection,branchId:null}]) {
    await assert.rejects(()=>db.query('UPDATE billing.subscriptions SET free_selection=$2 WHERE tenant_id=$1',[tenant,JSON.stringify(invalid)]),/free_selection_shape/);
  }
  await db.query('UPDATE billing.subscriptions SET free_selection=$2 WHERE tenant_id=$1',[tenant,JSON.stringify(selection)]);
  const before=(await db.query('SELECT current_period_end FROM billing.subscriptions WHERE tenant_id=$1',[tenant])).rows[0];
  assert.equal((await activateFreeTrial(db,tenant)).status,'FREE');
  assert.equal(String((await db.query('SELECT current_period_end FROM billing.subscriptions WHERE tenant_id=$1',[tenant])).rows[0].current_period_end),String(before.current_period_end));
  assert.equal((await subscriptionStatus(db,tenant)).outlets.limit,1);
  assert.deepEqual(await resolveFreeSyncScope(db,owner,'FNB'),{tenant_id:tenant,merchant_id:merchant,outlet_id:branch});
  await db.tx(async c=>{await c.exec('SET LOCAL ROLE svc_pos');assert.equal((await resolveFreeSyncScope(c,owner,'FNB'))?.outlet_id,branch);});
  await assert.rejects(()=>resolveFreeSyncScope(db,owner,'RETAIL'),/FREE_SELECTION_REQUIRED/);
  await db.query("INSERT INTO pos.products(id,tenant_id,merchant_id,outlet_id,name,sku,price,external_ref,is_available) VALUES($1,$2,$3,$4,'Retained product','retained',100,'retained',true)",[randomUUID(),tenant,merchant,otherBranch]);
  const send=(path:string,body:unknown)=>fetch(syncUrl+'/api/v1/sync/'+path,{method:'POST',headers:{authorization:'Bearer free-fixture','x-auth-sub':'forged-owner','content-type':'application/json'},body:JSON.stringify(body)});
  const target={businessId:owner+'_FNB',sector:'FNB',storeName:'Free fixture'};
  const catalog={...target,products:ids.map(id=>({id,name:id,price:100,costPrice:40,unit:'pcs'}))};
  const accepted=await send('catalog',catalog);
  assert.equal(accepted.status,200,await accepted.clone().text());
  assert.equal((await accepted.json()).retired,0);
  const select=(body:unknown)=>fetch(url+'/api/v1/subscription/free-plan',{method:'POST',headers:{'x-auth-sub':owner,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await select(selection)).status,200);
  assert.equal((await select({...selection,productIds:[...ids,'eleven']})).status,400);
  assert.equal((await select({...selection,branchId:otherBranch})).status,409);
  assert.equal((await db.query('SELECT free_selection FROM billing.subscriptions WHERE tenant_id=$1',[tenant])).rows[0].free_selection.branchId,branch);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM internal.tenants WHERE owner_user_ref=$1',[owner])).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM internal.outlets WHERE tenant_id=$1',[tenant])).rows[0].n,2);
  assert.equal((await db.query("SELECT is_available FROM pos.products WHERE tenant_id=$1 AND external_ref='retained'",[tenant])).rows[0].is_available,true);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pos.products WHERE tenant_id=$1 AND external_ref LIKE 'free-product-%' AND outlet_id=$2",[tenant,branch])).rows[0].n,10);
  assert.equal((await send('catalog',{...catalog,products:[...catalog.products,{id:'eleven',name:'Eleven'}]})).status,403);
  const transaction={clientTxnId:randomUUID(),cashierRef:owner,subtotal:100,totalAmount:100,paymentMethod:'CASH',paymentStatus:'PAID',items:[{productRef:ids[0],productName:ids[0],unitPrice:100,unitCost:40,quantity:1}]};
  const sale={...target,idempotencyKey:randomUUID(),transactions:[transaction]};
  const first=await send('transactions',sale);
  assert.equal(first.status,200,await first.clone().text());
  assert.equal((await first.json()).accepted,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM pos.users WHERE id=$1',[owner])).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM internal.users WHERE id=$1',[owner])).rows[0].n,1);
  assert.equal((await (await send('transactions',sale)).json()).replayed,true);
  const saved=(await db.query('SELECT tenant_id,merchant_id,outlet_id,total_amount FROM pos.transactions WHERE client_txn_id=$1',[transaction.clientTxnId])).rows;
  assert.equal(saved.length,1);assert.equal(saved[0].outlet_id,branch);assert.equal(Number(saved[0].total_amount),100);
  assert.equal((await send('transactions',{...sale,idempotencyKey:randomUUID(),transactions:[{...transaction,clientTxnId:randomUUID(),cashierRef:'staff-account'}]})).status,403);
  assert.equal((await send('transactions',{...sale,idempotencyKey:randomUUID(),transactions:[{...transaction,clientTxnId:randomUUID(),items:[{...transaction.items[0],productRef:'retained'}]}]})).status,403);
  // Selecting another branch must not move stock or overwrite its product mapping.
  await db.query('UPDATE billing.subscriptions SET free_selection=$2 WHERE tenant_id=$1',[tenant,JSON.stringify({...selection,branchId:otherBranch})]);
  assert.equal((await send('catalog',catalog)).status,403);
  assert.equal((await send('transactions',{...sale,idempotencyKey:randomUUID(),transactions:[{...transaction,clientTxnId:randomUUID()}]})).status,403);
  assert.equal((await db.query('SELECT outlet_id FROM pos.products WHERE tenant_id=$1 AND external_ref=$2',[tenant,ids[0]])).rows[0].outlet_id,branch);
  await db.query('UPDATE billing.subscriptions SET free_selection=$2 WHERE tenant_id=$1',[tenant,JSON.stringify(selection)]);
  await db.query('UPDATE internal.outlets SET is_active=false WHERE id=$1',[branch]);
  assert.equal((await send('catalog',catalog)).status,403);
  await db.query('UPDATE internal.outlets SET is_active=true WHERE id=$1',[branch]);
  await db.query("UPDATE billing.subscriptions SET plan_id='plan-plus-monthly',status='ACTIVE',current_period_end=now()+interval '30 days' WHERE tenant_id=$1",[tenant]);
  assert.equal(await resolveFreeSyncScope(db,owner,'FNB'),undefined);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM pos.products WHERE tenant_id=$1',[tenant])).rows[0].n,11);
  console.log('PASS: Free exact selected branch, no duplicate tenant/outlet, 10-product enforcement, owner-only sales, replay safety, data retention and upgrade');
  } finally {await new Promise<void>(resolve=>syncServer.close(()=>resolve()));}
}
