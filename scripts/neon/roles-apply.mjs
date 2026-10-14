import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'dotenv';
import pg from 'pg';
const env=parse(fs.readFileSync('.env.neon-data-restore.local'));
const target=JSON.parse(fs.readFileSync('neon/targets/full-restore.json','utf8'));
assert.equal(target.projectId,'steep-sea-66546931');assert.equal(target.default,false);assert.equal(env.NEON_BRANCH_ID,target.branchId);
const url=new URL(env.NEON_RESTORE_DATABASE_URL||'');assert.equal(url.hostname.replace('-pooler',''),target.host);assert.equal(url.pathname,'/'+target.database);url.hostname=url.hostname.replace('-pooler','');
for(const k of ['sslmode','channel_binding'])url.searchParams.delete(k);assert.equal(url.search,'');
const c=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000});await c.connect();
try{await c.query('BEGIN');await c.query(fs.readFileSync('neon/migrations/0005_runtime_roles.sql','utf8'));await c.query('COMMIT');console.log(JSON.stringify({status:'PASS',branchId:target.branchId,migration:'0005',sourceUnchanged:true}));}
catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{await c.end();}
