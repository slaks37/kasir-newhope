import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {parse} from 'dotenv';

const target=process.argv[2];
assert(['staging','production'].includes(target),'EXPLICIT_FULL_NEON_TARGET_REQUIRED');
const owners=parse(fs.readFileSync('.env.full-neon-owner.local'));
const u=new URL(owners[target==='staging'?'FULL_NEON_STAGING_OWNER_URL':'FULL_NEON_PRODUCTION_OWNER_URL']);
const expected=target==='staging'?'ep-flat-recipe-azti3hh0.c-3.ap-southeast-1.aws.neon.tech':'ep-twilight-moon-azqj69l8.c-3.ap-southeast-1.aws.neon.tech';
assert.equal(u.hostname.replace('-pooler',''),expected);u.hostname=expected;
for(const key of ['sslmode','channel_binding'])u.searchParams.delete(key);
const c=new pg.Client({connectionString:u.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:15000});
const role='newhope_clean_runtime',file='.env.full-neon-'+target+'.local';
const env=fs.existsSync(file)?parse(fs.readFileSync(file)):{};
await c.connect();
try{
 await c.query('BEGIN');
 const existing=(await c.query('SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=$1',[role])).rows[0];
 let password;
 if(existing){assert(Object.values(existing).every(v=>v===false),'UNSAFE_EXISTING_RUNTIME_ROLE');assert(env.DATABASE_URL,'EXISTING_RUNTIME_SECRET_REQUIRED');password=new URL(env.DATABASE_URL).password;}
 else{
  password=randomBytes(36).toString('base64url');
  await c.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT`);
 }
 const original=fs.readFileSync('neon/migrations/0005_runtime_roles.sql','utf8');
 const grants=original.slice(original.indexOf('  FOREACH s IN ARRAY'),original.indexOf('  GRANT USAGE ON SCHEMA newhope_auth'))
  .replace("    EXECUTE format('GRANT USAGE,CREATE ON SCHEMA %I TO newhope_migrator',s);",'')
  .replace("'internal.internal_access_log'","'internal.business_file_events','internal.internal_access_log'")
  .replaceAll('newhope_runtime',role)
  .replace("'security_acl_rollback_sequence_seq'","'security_acl_rollback_sequence_seq','full_neon_bootstrap_evidence'");
 await c.query('DO $$DECLARE s text;r record;BEGIN '+grants+' END$$');
 await c.query(`GRANT CONNECT ON DATABASE ${u.pathname.slice(1)} TO ${role}`);
 await c.query(`ALTER ROLE ${role} SET statement_timeout='8s'`);
 await c.query(`ALTER ROLE ${role} SET idle_in_transaction_session_timeout='10s'`);
 await c.query(`REVOKE UPDATE,DELETE,TRUNCATE ON internal.business_file_events FROM ${role}`);
 await c.query(`REVOKE ALL ON billing.doku_release_acceptances FROM ${role}`);
 await c.query(`GRANT SELECT ON billing.doku_release_acceptances TO ${role}`);
 await c.query('COMMIT');
 const a=new URL(u.href);a.pathname='/neondb';
 const auth=new pg.Client({connectionString:a.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:15000});await auth.connect();
 try{
  await auth.query(`GRANT CONNECT ON DATABASE neondb TO ${role}`);
  await auth.query(`GRANT USAGE ON SCHEMA neon_auth TO ${role}`);
  await auth.query(`GRANT SELECT(id,email,"emailVerified",banned) ON neon_auth."user" TO ${role}`);
 }finally{await auth.end();}
 u.username=role;u.password=decodeURIComponent(password);u.hostname=u.hostname.replace('.c-3.','-pooler.c-3.');u.searchParams.set('sslmode','verify-full');
 const authUrl=new URL(u.href);authUrl.pathname='/neondb';
 const vars={...env,DATABASE_URL:u.href,NEON_AUTH_DATABASE_URL:authUrl.href,ADMIN_MFA_ENCRYPTION_KEY:env.ADMIN_MFA_ENCRYPTION_KEY||randomBytes(32).toString('base64')};
 fs.writeFileSync(file,Object.entries(vars).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600});fs.chmodSync(file,0o600);
 console.log(JSON.stringify({status:'PASS',target,role,tlsVerified:c.connection.stream.authorized,managedAuthReadOnly:true,credentialsPrinted:false}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{await c.end();}
