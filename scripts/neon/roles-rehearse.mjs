import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'dotenv';
import pg from 'pg';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]||fallback;};
const env=parse(fs.readFileSync(arg('--env','.env.neon-data-restore.local')));
const target=JSON.parse(fs.readFileSync(arg('--target','neon/targets/full-restore.json'),'utf8'));
assert.equal(target.projectId,'steep-sea-66546931');assert.equal(env.NEON_PROJECT_ID,target.projectId);assert.equal(env.NEON_BRANCH_ID,target.branchId);
assert.equal(target.default,false);assert.notEqual(target.branchId,'br-falling-butterfly-az989m86');
const url=new URL(env.NEON_RESTORE_DATABASE_URL||env.NEON_STAGING_DATABASE_URL||'');
assert.equal(url.hostname.replace('-pooler',''),target.host);assert.equal(url.pathname,'/'+target.database);assert.equal(url.protocol,'postgresql:');
url.hostname=url.hostname.replace('-pooler','');
for(const k of ['sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat'])url.searchParams.delete(k);
assert([...url.searchParams.keys()].every(k=>['application_name','channel_binding'].includes(k)));
const client=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000});
const evidence={scope:'Neon isolated child; additive role migration and rollback rehearsal; no application row changes committed',branchId:target.branchId,startedAt:new Date().toISOString(),checks:{},status:'RUNNING'};
const q=s=>'"'+s.replaceAll('"','""')+'"';
const apply=fs.readFileSync('neon/migrations/0005_runtime_roles.sql','utf8'),rollback=fs.readFileSync('scripts/neon/roles-rollback.sql','utf8');
await client.connect();
async function roleProbe(role,checks) {
  await client.query('BEGIN');let denied=0,allowed=0;
  try {
    const owner=(await client.query('SELECT current_user AS role')).rows[0].role;
    await client.query(`GRANT ${q(role)} TO ${q(owner)} WITH INHERIT FALSE,SET TRUE`);
    await client.query('SET LOCAL ROLE '+q(role));
    for(const {sql,deny} of checks) {
      await client.query('SAVEPOINT p');
      try{await client.query(sql);if(deny)throw Error('UNEXPECTED_ROLE_ACCESS:'+role+':'+sql);allowed++;}
      catch(e){await client.query('ROLLBACK TO SAVEPOINT p');if(!deny||e.code!=='42501')throw e;denied++;}
      finally{await client.query('RELEASE SAVEPOINT p');}
    }
    return {allowed,denied};
  }finally{await client.query('ROLLBACK');}
}
try {
  assert.equal(client.connection.stream.authorized,true);assert.equal(client.connection.stream.encrypted,true);
  assert((await client.query("SELECT to_regclass('newhope_auth.account') AS auth,to_regclass('public.blog_posts') AS blog")).rows[0].auth,'Auth schema must be bootstrapped first');
  await client.query('BEGIN');await client.query(apply);await client.query('COMMIT');
  const rels=(await client.query(`SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN('public','pos','internal','billing','ai','contract','mcp_private','blog_mcp_private') AND c.relkind IN('r','p','v','m','S')
      AND c.relname NOT IN('schema_migrations','security_acl_rollback','security_acl_rollback_sequence_seq')`)).rows;
  const app=rels.map(r=>({sql:r.relkind==='S'?`SELECT last_value FROM ${q(r.nspname)}.${q(r.relname)}`:`SELECT * FROM ${q(r.nspname)}.${q(r.relname)} LIMIT 0`,deny:false}));
  // The statement actually executes under the restricted role; a grant
  // catalog check alone is not counted as negative authorization evidence.
  for(const table of ['account','session','twoFactor','verification','rateLimit','mfa_session_proofs','user'])app.push({sql:`SELECT * FROM newhope_auth.${q(table)} LIMIT 0`,deny:true});
  app.push(...['CREATE TABLE pos.__role_probe(id int)','ALTER TABLE pos.products ADD COLUMN __role_probe int','TRUNCATE pos.products','CREATE ROLE __newhope_probe',
    'UPDATE pos.cash_ledger SET amount=amount WHERE false','DELETE FROM internal.internal_access_log WHERE false','SELECT * FROM internal.security_acl_rollback LIMIT 0'].map(sql=>({sql,deny:true})));
  evidence.checks.app=await roleProbe('newhope_runtime',app);
  evidence.checks.auth=await roleProbe('newhope_auth_runtime',[
    ...['account','session','twoFactor','verification','rateLimit','mfa_session_proofs','user'].map(t=>({sql:`SELECT * FROM newhope_auth.${q(t)} LIMIT 0`,deny:false})),
    {sql:'SELECT * FROM internal.auth_identity_bindings LIMIT 0',deny:false},{sql:'SELECT * FROM internal.users LIMIT 0',deny:false},
    ...['SELECT * FROM pos.transactions LIMIT 0','SELECT * FROM billing.invoices LIMIT 0','SELECT * FROM ai.merchant_ai_credits LIMIT 0','SELECT * FROM public.blog_posts LIMIT 0',
      'DELETE FROM internal.users WHERE false','CREATE TABLE newhope_auth.__role_probe(id int)','TRUNCATE newhope_auth.session','CREATE ROLE __newhope_probe'].map(sql=>({sql,deny:true})),
  ]);
  for(const role of ['anon','authenticated']) {
    evidence.checks[role]=await roleProbe(role,rels.filter(r=>r.relkind!=='S').map(r=>({sql:`SELECT * FROM ${q(r.nspname)}.${q(r.relname)} LIMIT 0`,deny:true})));
  }
  const roleAttrs=(await client.query("SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname IN('newhope_runtime','newhope_auth_runtime','newhope_migrator')")).rows;
  assert.equal(roleAttrs.length,3);for(const r of roleAttrs)for(const k of ['rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls','rolcanlogin'])assert.equal(r[k],false);
  evidence.checks.roleAttributes='PASS: no login, superuser, bypass RLS, role/database creation or replication on privilege groups';
  for(const r of roleAttrs)assert.equal((await client.query("SELECT pg_has_role($1,'neondb_owner','MEMBER') AS member",[r.rolname])).rows[0].member,false);
  evidence.checks.membership='PASS: groups have no owner membership; SET ROLE owner denial must additionally be tested using actual runtime LOGIN (admin session SET LOCAL ROLE cannot test this)';
  await client.query('BEGIN');await client.query(rollback);await client.query('COMMIT');
  evidence.checks.rollback=await roleProbe('newhope_runtime',[{sql:'SELECT * FROM public.blog_posts LIMIT 0',deny:true}]);
  await client.query('BEGIN');await client.query(apply);await client.query('COMMIT');
  evidence.checks.reapply=await roleProbe('newhope_runtime',[{sql:'SELECT * FROM public.blog_posts LIMIT 0',deny:false}]);
  evidence.status='PASS';console.log(JSON.stringify({status:'PASS',branchId:target.branchId,checks:evidence.checks}));
}catch(e){await client.query('ROLLBACK').catch(()=>{});evidence.status='FAIL';evidence.failure=e.code||e.message;throw e;}
finally{await client.end();evidence.finishedAt=new Date().toISOString();fs.mkdirSync('build/neon',{recursive:true});fs.writeFileSync('build/neon/roles-evidence.json',JSON.stringify(evidence,null,2)+'\n');}
