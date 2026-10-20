// Isolated native Neon test; provider HTTP stays mocked in testQrisSubscriptions.
import fs from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import assert from 'node:assert/strict';
import type {Db} from '../../services/shared/db';
import {testQrisSubscriptions} from '../dev/test-qris-subscriptions';
const env=dotenv.parse(fs.readFileSync('.env.qris-preview.local'));
const u=new URL(env.DATABASE_URL);
if(u.pathname!=='/newhope_qris_preview'||u.username!=='newhope_qris_preview_runtime'||u.hostname!=='ep-long-glade-azcugn8m-pooler.c-3.ap-southeast-1.aws.neon.tech'||u.searchParams.get('sslmode')!=='verify-full')throw Error('ISOLATED_RESTRICTED_TARGET_REQUIRED');
const pool=new pg.Pool({connectionString:u.href,max:3,connectionTimeoutMillis:5000,statement_timeout:15000,ssl:{rejectUnauthorized:true}});
const wrap=(q:pg.Pool|pg.PoolClient):Db=>({query:async(s,p)=>{const r=await q.query(s,p);return{rows:r.rows,rowCount:r.rowCount||0};},exec:async(s)=>{await q.query(s);},tx:async(fn)=>{const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(wrap(c));await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}},close:()=>pool.end()});
try{
 const facts=(await pool.query("SELECT current_database() db,current_user actor,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0];
 assert.equal(facts.db,'newhope_qris_preview');for(const field of ['rolsuper','rolbypassrls','rolcreaterole'])assert.equal(facts[field],false);
 for(const rel of ['pos.transactions','internal.internal_users','public.blog_posts'])await assert.rejects(()=>pool.query('SELECT * FROM '+rel+' LIMIT 1'),/permission denied|does not exist/);
 // The native adapter returns row-count fields in the same shape as PGlite.
 pg.types.setTypeParser(20,Number);pg.types.setTypeParser(1700,Number);
 const start=Date.now();await testQrisSubscriptions(wrap(pool));
 console.log(JSON.stringify({result:'PASS',target:facts.db,role:facts.actor,provider:'MOCK_ONLY',durationMs:Date.now()-start,tlsClientToPooler:'verify-full',productionChanged:false}));
}finally{await pool.end();}
