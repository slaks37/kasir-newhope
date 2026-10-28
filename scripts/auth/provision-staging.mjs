/** Explicit empty-database rehearsal. Never reads a production connection or loads .env. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import {migrationFiles} from '../db/migration-files.mjs';
const source=process.argv[2],output=process.argv[3];if(!source||!output)throw Error('PRIVATE_STAGING_URL_AND_OUTPUT_REQUIRED');
const url=new URL(fs.readFileSync(source,'utf8').trim());
if(!url.hostname.endsWith('.neon.tech')||url.pathname!=='/newhope_auth_pr29'||url.username!=='neondb_owner'||url.searchParams.has('host'))throw Error('STAGING_DATABASE_TARGET_REJECTED');
const client=new pg.Client({connectionString:url.href});await client.connect();
try{
 const existing=(await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")).rows[0].n;const resume=process.argv[4]==='--resume-auth';
 if(existing!==0&&!resume)throw Error('EMPTY_STAGING_DATABASE_REQUIRED');
 if(resume){for(const table of ['internal.users','internal.tenants','pos.transactions']){const count=(await client.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n;if(count!==0){if(table!=='internal.users'||count!==1||(await client.query("SELECT 1 FROM internal.users WHERE id=public.legacy_uuid('int-root') AND email='ops@newhopepos.id' AND full_name='Platform Root' AND is_platform_user AND platform_role='ROLE_SUPERADMIN'")).rows.length!==1)throw Error('STAGING_RESUME_DATA_DRIFT');}}}
 const files=migrationFiles().map(file=>file.path);
 for(const file of (resume?['migrations/0070_neon_auth_runtime.sql']:files)){await client.query(fs.readFileSync(file,'utf8'));console.log('Applied',file);}
 const roles=(await client.query("SELECT rolname FROM pg_roles WHERE rolname LIKE 'svc_%'")).rows.map(r=>r.rolname);
 const createLogin=async(name,groups)=>{
  if((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name])).rows.length)throw Error('STAGING_LOGIN_ALREADY_EXISTS');
  const password=crypto.randomBytes(32).toString('base64url');await client.query('CREATE ROLE '+name+" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
  for(const group of groups){if(!/^svc_[a-z_]+$/.test(group))throw Error('ROLE_REJECTED');await client.query('GRANT '+group+' TO '+name);}
  const conn=new URL(url);conn.username=name;conn.password=password;return conn.href;
 };
 const auth=await createLogin('newhope_auth_pr29_login',['svc_auth']);
 const app=await createLogin('newhope_app_pr29_login',roles.filter(r=>['svc_pos','svc_billing','svc_ai','svc_internal','svc_analytics','svc_bi','svc_staff'].includes(r)));
 const env={AUTH_PROVIDER:'neon',VITE_AUTH_PROVIDER:'neon',NEWHOPE_NEON_AUTH_STAGING:'1',APP_ENV:'staging',DATABASE_URL:app,BETTER_AUTH_DATABASE_URL:auth,BETTER_AUTH_SECRET:crypto.randomBytes(48).toString('base64url'),NEWHOPE_AUTH_NEON_HOST:url.hostname.replace('-pooler',''),NEWHOPE_AUTH_NEON_BRANCH_ID:'br-plain-snow-azjwwq6u',NEW_HOPE_MODULE_WORKSPACES:'0',VITE_MODULE_WORKSPACES:'0',NEW_HOPE_NATIVE_ORIGINS:'capacitor://localhost,https://localhost',NEWHOPE_AUTH_URL:'',VITE_NEWHOPE_AUTH_URL:'',NEWHOPE_GOOGLE_CLIENT_ID:'',NEWHOPE_GOOGLE_CLIENT_SECRET:''};
 fs.writeFileSync(output,Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600});
 console.log('Provisioned isolated empty auth database; private staging config written. Operational rows copied: 0.');
}finally{await client.end();}
