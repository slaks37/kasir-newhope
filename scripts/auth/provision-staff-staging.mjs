/** Approved PR30 staging only. Refuses populated databases/existing LOGINs.
 * Owner URL and resulting secrets use private files, never stdout. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import {migrationFiles} from '../db/migration-files.mjs';
const [source,output]=process.argv.slice(2);if(!source||!output)throw Error('PRIVATE_STAGING_FILES_REQUIRED');
const u=new URL(fs.readFileSync(source,'utf8').trim());
if(u.pathname!=='/newhope_phase2_staff'||u.username!=='neondb_owner'||!u.hostname.endsWith('.neon.tech')||u.hostname.includes('-pooler')||u.searchParams.has('host'))throw Error('PHASE2_STAGING_TARGET_REJECTED');
const c=new pg.Client({connectionString:u.href});await c.connect();
try{
 if(Number((await c.query("SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN('pg_catalog','information_schema')")).rows[0].count)!==0)throw Error('EMPTY_PHASE2_DATABASE_REQUIRED');
 for(const file of migrationFiles()){await c.query(fs.readFileSync(file.path,'utf8'));console.log('Applied',file.name);}
 const login=async(name,groups)=>{
  if((await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name])).rows.length)throw Error('PHASE2_LOGIN_ALREADY_EXISTS');
  const password=crypto.randomBytes(36).toString('base64url');
  await c.query('CREATE ROLE '+name+" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
  for(const g of groups)await c.query('GRANT '+g+' TO '+name);
  const value=new URL(u);value.username=name;value.password=password;return value.href;
 };
 const auth=await login('newhope_phase2_auth_login',['svc_auth']);
 const app=await login('newhope_phase2_app_login',['svc_pos','svc_internal','svc_billing','svc_ai','svc_staff']);
 const base='https://kasir-newhope-git-codex-phase2-staff-o-518137-slaks37s-projects.vercel.app';
 const env={AUTH_PROVIDER:'neon',VITE_AUTH_PROVIDER:'neon',NEWHOPE_NEON_AUTH_STAGING:'1',APP_ENV:'staging',DATABASE_URL:app,BETTER_AUTH_DATABASE_URL:auth,BETTER_AUTH_SECRET:crypto.randomBytes(48).toString('base64url'),NEWHOPE_AUTH_NEON_HOST:u.hostname,NEWHOPE_AUTH_NEON_BRANCH_ID:'br-plain-snow-azjwwq6u',NEW_HOPE_MODULE_WORKSPACES:'0',VITE_MODULE_WORKSPACES:'0',NEW_HOPE_NATIVE_ORIGINS:'capacitor://localhost,https://localhost',NEWHOPE_AUTH_URL:base,VITE_NEWHOPE_AUTH_URL:base+'/api/auth',VITE_NATIVE_API_ORIGIN:base};
 fs.writeFileSync(output,Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600,flag:'wx'});
 console.log('PASS empty PR30 staging provisioned: distinct restricted LOGINs, fresh secret, no source/production rows copied; module/native gates unchanged');
}finally{await c.end();}
