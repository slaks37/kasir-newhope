// Real HTTP + SQL: the serverless entry must initialize the same catalog as the
// long-running billing service before a first verified account requests status.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import type {Db} from '../../services/shared/db';
import {createBillingHandler} from '../../src/server/billingHandler';
import {SAAS_PLANS,TRIAL_PLAN_ID} from '../../src/config/saasPlans';
const pg=new PGlite();
for(const file of ['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f)])await pg.exec(fs.readFileSync(file,'utf8'));
const wrap=(runner:any):Db=>({query:async(sql,params)=>{const r=await runner.query(sql,params);return {rows:r.rows,rowCount:r.affectedRows??r.rows.length};},exec:async sql=>{await runner.exec(sql);},tx:fn=>pg.transaction(c=>fn(wrap(c))),close:async()=>{}});
const db=wrap(pg),owner=randomUUID();
assert.equal((await db.query('SELECT id FROM billing.plans WHERE id=$1',[TRIAL_PLAN_ID])).rows.length,0,'No test helper preloads the missing canonical trial plan');
await db.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Bootstrap owner')",[owner,owner+'@fixture.invalid']);
await db.query("INSERT INTO billing.plans(id,name,tier_level,billing_cycle,price_idr,product_limit,features) VALUES('historical-plan','Historical',1,'MONTHLY',12345,25,'[]')");
const historical=await db.query("SELECT row_to_json(p) AS value FROM billing.plans p WHERE id='historical-plan'");
const app=express();let connections=0;const auth=async(req:any)=>req.headers.authorization==='Bearer verified-fixture'?{subject:owner,isEmailVerified:true}:null;
const attach=()=>createBillingHandler(auth,async()=>{connections++;return db;});app.use(attach());
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const base='http://127.0.0.1:'+(server.address() as any).port,headers={authorization:'Bearer verified-fixture'};
try{
 assert.equal((await fetch(base+'/api/v1/subscription/status')).status,401);assert.equal(connections,0,'Anonymous requests never seed or connect');
 const first=await fetch(base+'/api/v1/subscription/status',{headers});assert.equal(first.status,200);const status=await first.json();assert.equal(status.ok,true);assert.equal(status.subscription.planId,TRIAL_PLAN_ID);assert.equal(status.subscription.status,'TRIAL');
 assert.equal((await fetch(base+'/api/v1/subscription/status',{headers})).status,200);assert.equal(connections,1,'Warm runtime shares initialization');
 const cold=express();cold.use(attach());const retryServer=cold.listen(0,'127.0.0.1');await new Promise<void>(r=>retryServer.once('listening',r));
 try{assert.equal((await fetch('http://127.0.0.1:'+(retryServer.address() as any).port+'/api/v1/subscription/status',{headers})).status,200);}finally{await new Promise<void>(r=>retryServer.close(()=>r()));}
 assert.equal((await db.query('SELECT count(*)::int AS n FROM billing.subscriptions')).rows[0].n,1,'Cold-start replay preserves the existing subscription');
 assert.deepEqual((await db.query("SELECT row_to_json(p) AS value FROM billing.plans p WHERE id='historical-plan'")).rows,historical.rows,'Historical catalog rows are preserved');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM pos.transactions')).rows[0].n,0);
 for(const plan of SAAS_PLANS)assert.equal((await db.query('SELECT id FROM billing.plans WHERE id=$1',[plan.id])).rows.length,1);
 console.log('PASS serverless billing bootstrap: authenticated cold status initializes canonical plans, preserves historical catalog and subscription, replays without duplicates; no financial ledger writes');
}finally{await new Promise<void>(r=>server.close(()=>r()));await pg.close();}
