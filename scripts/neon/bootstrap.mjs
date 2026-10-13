import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {stagingTarget,projectId,branchId} from './target.mjs';

const {env,...config}=stagingTarget();
const client=new pg.Client(config);
const evidence={scope:'EMPTY NEON CHILD BRANCH; no customer data; repository-schema rehearsal only',projectId,branchId,
  startedAt:new Date().toISOString(),files:[],status:'RUNNING'};
await client.connect();
try {
  const objects=(await client.query("SELECT n.nspname,count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','pos','internal','billing','ai','contract') AND c.relkind IN('r','p','v','m','S') GROUP BY 1")).rows;
  assert.equal(objects.length,0,'Refuse a populated application schema, before any DDL');
  evidence.postgresVersion=(await client.query('SHOW server_version')).rows[0].server_version;
  assert.equal(client.connection.stream.encrypted,true);
  assert.equal(client.connection.stream.authorized,true);
  evidence.clientTls={encrypted:true,certificateAuthorized:true};
  evidence.proxyToComputeSsl=(await client.query('SELECT ssl,version FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0];
  const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',
    ...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f),
    ...['free-plan-selection.sql','free-plan-ai-credit-access.sql','restrict-browser-rls-policies.sql','intelligence-cache.sql','intelligence-wallet.sql'].map(f=>'docs/security/'+f),
    ...fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('_business_scoped_operational_state.sql')).sort().map(f=>'supabase/migrations/'+f),
    'supabase/migrations/20261013033203_browser_role_least_privilege.sql',
    'neon/migrations/0001_identity_bindings.sql'];
  for(const file of files) {
    const sql=fs.readFileSync(file,'utf8');
    try {await client.query('BEGIN');await client.query(sql);await client.query('COMMIT');}
    catch(e){await client.query('ROLLBACK');throw Error('BOOTSTRAP_FILE_FAILED:'+file+':'+e.code+':'+e.message);}
    evidence.files.push({path:file,sha256:createHash('sha256').update(sql).digest('hex')});
  }
  await client.query("INSERT INTO billing.plans(id,name,tier_level,billing_cycle,price_idr,features) VALUES('plan-free','Free Trial 45 Hari',1,'MONTHLY',0,'[]'::jsonb) ON CONFLICT DO NOTHING");
  evidence.relations=(await client.query("SELECT n.nspname AS schema,count(*)::int objects FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','pos','internal','billing','ai','contract') AND c.relkind IN('r','p','v','m','S') GROUP BY 1 ORDER BY 1")).rows;
  evidence.status='PASS';
  console.log('PASS: isolated Neon repository-schema bootstrap and verified TLS; no production restore claimed');
}catch(e){evidence.status='FAIL';evidence.failure=e.message;throw e;}
finally {
  fs.mkdirSync('build/neon',{recursive:true});
  fs.writeFileSync('build/neon/bootstrap.json',JSON.stringify(evidence,null,2)+'\n');
  await client.end();
}
