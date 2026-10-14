import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {parse} from 'dotenv';
import pg from 'pg';
const env=parse(fs.readFileSync('.env.neon-runtime-roles.local'));
const target=JSON.parse(fs.readFileSync('neon/targets/full-restore.json','utf8'));
assert.equal(target.projectId,'steep-sea-66546931');assert.equal(target.default,false);assert.equal(env.NEON_BRANCH_ID,target.branchId);
const evidence={scope:'Actual restricted LOGIN sessions; synthetic writes rolled back; no production access',branchId:target.branchId,startedAt:new Date().toISOString(),checks:{},status:'RUNNING'};
async function verify(key,login,group,allow,deny,write) {
  const url=new URL(env[key]||'');assert.equal(decodeURIComponent(url.username),login);assert.equal(url.hostname.replace('-pooler',''),target.host);assert.equal(url.pathname,'/'+target.database);
  url.hostname=url.hostname.replace('-pooler','');for(const k of ['sslmode','channel_binding'])url.searchParams.delete(k);assert.equal(url.search,'');
  const c=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000});await c.connect();
  try {
    assert(c.connection.stream.encrypted&&c.connection.stream.authorized);
    const role=(await c.query('SELECT current_user,session_user')).rows[0];assert.equal(role.current_user,login);assert.equal(role.session_user,login);
    assert.equal((await c.query("SELECT pg_has_role(current_user,$1,'MEMBER') AS expected,pg_has_role(current_user,'neondb_owner','MEMBER') AS owner",[group])).rows[0].expected,true);
    const attrs=(await c.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    for(const v of Object.values(attrs))assert.equal(v,false);
    let allowed=0,denied=0;await c.query('BEGIN');
    for(const sql of allow){await c.query(sql);allowed++;}
    for(const sql of deny) {
      await c.query('SAVEPOINT p');
      try{await c.query(sql);throw Error('UNEXPECTED_ROLE_ACCESS:'+login+':'+sql);}
      catch(e){await c.query('ROLLBACK TO SAVEPOINT p');assert.equal(e.code,'42501','Must be privilege rejection');denied++;}
      finally{await c.query('RELEASE SAVEPOINT p');}
    }
    await write(c);await c.query('ROLLBACK');return {allowed,denied,syntheticWriteRollback:true,tlsVerified:true,currentUser:login};
  }finally{await c.query('ROLLBACK').catch(()=>{});await c.end();}
}
try {
  evidence.checks.app=await verify('DATABASE_URL','newhope_runtime_login','newhope_runtime',
    ['SELECT * FROM pos.transactions LIMIT 0','SELECT * FROM billing.subscriptions LIMIT 0','SELECT * FROM ai.merchant_ai_credits LIMIT 0','SELECT * FROM internal.auth_identity_bindings LIMIT 0','SELECT * FROM public.blog_posts LIMIT 0'],
    ['SELECT * FROM newhope_auth.account LIMIT 0','SELECT * FROM newhope_auth.session LIMIT 0','SELECT * FROM newhope_auth."twoFactor" LIMIT 0','SELECT * FROM newhope_auth."user" LIMIT 0',
      'SET ROLE neondb_owner','SET ROLE newhope_auth_runtime','CREATE ROLE __newhope_probe','CREATE TABLE pos.__role_probe(id int)','ALTER TABLE pos.products ADD COLUMN __role_probe int','TRUNCATE pos.transactions','UPDATE pos.cash_ledger SET amount=amount WHERE false','DELETE FROM internal.internal_access_log WHERE false',
      'INSERT INTO ai.credit_ledger DEFAULT VALUES','UPDATE ai.credit_ledger SET delta=delta WHERE false','DELETE FROM ai.credit_ledger WHERE false','TRUNCATE ai.credit_ledger'],
    async c=>{
      const id='role-probe-'+randomUUID();
      await c.query("INSERT INTO public.blog_posts(id,slug,title,content,category,is_published) VALUES($1,$1,'Synthetic role probe','Synthetic rollback-only','Tips Bisnis & Strategi',false)",[id]);
      assert.equal((await c.query('SELECT id FROM public.blog_posts WHERE id=$1',[id])).rowCount,1);
      await c.query('UPDATE public.blog_posts SET title=$1 WHERE id=$2',['Synthetic changed',id]);
      assert.equal((await c.query('DELETE FROM public.blog_posts WHERE id=$1',[id])).rowCount,1);
    });
  evidence.checks.auth=await verify('BETTER_AUTH_DATABASE_URL','newhope_auth_runtime_login','newhope_auth_runtime',
    ['SELECT * FROM newhope_auth.account LIMIT 0','SELECT * FROM newhope_auth.session LIMIT 0','SELECT * FROM newhope_auth."rateLimit" LIMIT 0','SELECT * FROM newhope_auth.mfa_session_proofs LIMIT 0','SELECT * FROM internal.auth_identity_bindings LIMIT 0'],
    ['SELECT * FROM pos.transactions LIMIT 0','SELECT * FROM billing.subscriptions LIMIT 0','SELECT * FROM public.blog_posts LIMIT 0','SET ROLE neondb_owner','SET ROLE newhope_runtime','CREATE ROLE __newhope_probe','CREATE TABLE newhope_auth.__role_probe(id int)','TRUNCATE newhope_auth.session','DELETE FROM internal.users WHERE false'],
    async c=>{
      const id='role-probe-'+randomUUID();await c.query('INSERT INTO newhope_auth."rateLimit"(id,key,count,"lastRequest") VALUES($1,$1,1,0)',[id]);
      assert.equal((await c.query('SELECT id FROM newhope_auth."rateLimit" WHERE id=$1',[id])).rowCount,1);
      await c.query('UPDATE newhope_auth."rateLimit" SET count=2 WHERE id=$1',[id]);assert.equal((await c.query('DELETE FROM newhope_auth."rateLimit" WHERE id=$1',[id])).rowCount,1);
    });
  evidence.status='PASS';console.log(JSON.stringify({status:'PASS',branchId:target.branchId,checks:evidence.checks}));
}catch(e){evidence.status='FAIL';evidence.failure=e.code||e.message;throw e;}
finally{evidence.finishedAt=new Date().toISOString();fs.mkdirSync('build/neon',{recursive:true});fs.writeFileSync('build/neon/roles-login-evidence.json',JSON.stringify(evidence,null,2)+'\n');}
