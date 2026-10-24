import {testDokuFallback} from './test-doku-fallback';
// CI-only disposable loopback PostgreSQL17. Refuses every remote URL.
import fs from 'node:fs';import assert from 'node:assert/strict';import pg from 'pg';
import {rehearsalTarget} from './rehearsal-target.mjs';
import {testQrisSubscriptions} from './test-qris-subscriptions';import {testDokuAdversarial} from './test-doku-adversarial';import {testDokuReleaseAcceptance} from './test-doku-release-acceptance';
import {pastikanPaket} from '../../services/billing/store';import {SAAS_PLANS} from '../../src/config/saasPlans';import type {Db} from '../../services/shared/db';
const base=rehearsalTarget(process.env),root=new pg.Client({connectionString:base});await root.connect();const name='newhope_payments_rehearsal';
try{assert.equal((await root.query('SHOW server_version_num')).rows[0].server_version_num.slice(0,2),'17');assert.equal((await root.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount,0,'Refuse existing payment rehearsal database');await root.query('CREATE DATABASE '+name);}finally{await root.end();}
const u=new URL(base);u.pathname='/'+name;const pool=new pg.Pool({connectionString:u.href,max:6});
const wrap=(q:pg.Pool|pg.PoolClient):Db=>({query:async(s,p)=>{const r=await q.query(s,p as any[]);return{rows:r.rows,rowCount:r.rowCount||0};},exec:async s=>{await q.query(s);},tx:async f=>{if(q!==pool)return f(wrap(q));const c=await pool.connect();try{await c.query('BEGIN');const r=await f(wrap(c));await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}},close:()=>pool.end()});
const db=wrap(pool);const start=Date.now();
try{
 assert.equal(Number((await db.query("SELECT count(*) n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).rows[0].n),0);
 for(const f of ['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f)])await db.exec(fs.readFileSync(f,'utf8'));
 await pastikanPaket(db,SAAS_PLANS);await testQrisSubscriptions(db);await testDokuAdversarial(db);await testDokuReleaseAcceptance(db);await testDokuFallback(db);
 const counts=(await db.query('SELECT (SELECT count(*) FROM billing.invoices) invoices,(SELECT count(*) FROM billing.payment_events) events')).rows[0];
 fs.mkdirSync('build/security-rehearsal',{recursive:true});fs.writeFileSync('build/security-rehearsal/payments-postgres17.json',JSON.stringify({status:'PASS',database:'disposable loopback PostgreSQL17',provider:'MOCK ONLY',realPayment:false,tests:['previous three defects','cross-instance inquiry cooldown and clock skew','checkout and receipt races','wrong amount/currency/tenant/channel/reference','database activation rollback','delayed fulfillment','refund/reversal hold','durable release acceptance ACL'],syntheticCounts:counts,durationMs:Date.now()-start},null,2));console.log('PASS native PostgreSQL17 DOKU/payment security suite');
}finally{await pool.end();}
