import fs from 'node:fs';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import pg from 'pg';import {parse} from 'dotenv';
import {restoreTarget,loadBackup,privateFile,isHybridRestore} from './backup-common.mjs';
assert(isHybridRestore(),'REVIEWED_HYBRID_TARGET_REQUIRED');
const {env,manifest,...config}=restoreTarget(),{snapshot:s}=await loadBackup();const c=new pg.Client(config);await c.connect();
try{assert(c.connection.stream.authorized);await c.query('BEGIN');
 const original=fs.readFileSync('neon/migrations/0005_runtime_roles.sql','utf8');
 // Reuse reviewed business grants verbatim, omitting the separate native-auth
 // portion. No newhope_auth schema or auth LOGIN is created in phase1.
 const business=original.slice(original.indexOf('  FOREACH s IN ARRAY'),original.indexOf('  GRANT USAGE ON SCHEMA newhope_auth')).replace("    EXECUTE format('GRANT USAGE,CREATE ON SCHEMA %I TO newhope_migrator',s);",'');
 assert(business.includes('GRANT SELECT,INSERT')&&!business.includes('newhope_auth'));
 await c.query("DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='newhope_runtime') THEN CREATE ROLE newhope_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF;END$$");
 await c.query('DO $$DECLARE s text;r record;BEGIN '+business+' END$$');
 await c.query('GRANT CONNECT ON DATABASE neondb TO newhope_runtime');
 await c.query(fs.readFileSync('neon/migrations/0011_hybrid_phase1.sql','utf8'));
 for(const a of s.authMetadata)await c.query('INSERT INTO internal.hybrid_source_accounts(source_uuid,source_created_at) VALUES($1,$2) ON CONFLICT(source_uuid) DO NOTHING',[a.id,a.created_at]);
 await c.query('INSERT INTO internal.hybrid_phase1_state(singleton,source_project,source_cutover_at) VALUES(true,$1,$2) ON CONFLICT(singleton) DO NOTHING',[s.sourceProject,s.capturedAt]);
 for(const table of ['hybrid_source_accounts','hybrid_phase1_state']){await c.query('REVOKE ALL ON internal.'+table+' FROM newhope_runtime');await c.query('GRANT SELECT ON internal.'+table+' TO newhope_runtime');await c.query("DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='internal."+table+"'::regclass AND polname='hybrid_runtime_read') THEN CREATE POLICY hybrid_runtime_read ON internal."+table+" FOR SELECT TO newhope_runtime USING(true); END IF;END$$");}
 const login='newhope_runtime_login',file=process.env.NEON_RESTORE_TARGET==='hybrid-candidate'?'.env.neon-hybrid-candidate-runtime.local':'.env.neon-hybrid-runtime.local';let password;
 const existing=(await c.query('SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1',[login])).rows[0];
 if(existing){assert(fs.existsSync(file));assert(existing.rolcanlogin&&!existing.rolsuper&&!existing.rolbypassrls&&!existing.rolcreatedb&&!existing.rolcreaterole);password=decodeURIComponent(new URL(parse(privateFile(file)).DATABASE_URL).password);}else{password=randomBytes(36).toString('base64url');await c.query("CREATE ROLE newhope_runtime_login LOGIN PASSWORD '"+password+"' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT");}
 await c.query('GRANT newhope_runtime TO newhope_runtime_login');await c.query("ALTER ROLE newhope_runtime_login SET statement_timeout='8s'");
 const u=new URL('postgresql://'+manifest.host.replace('.c-3.','-pooler.c-3.')+'/neondb');u.username=login;u.password=password;u.searchParams.set('sslmode','require');
 fs.writeFileSync(file,'DATABASE_URL='+u.href+'\nNEON_PROJECT_ID='+manifest.projectId+'\nNEON_BRANCH_ID='+manifest.branchId+'\n',{mode:0o600});
 assert.equal((await c.query("SELECT to_regclass('newhope_auth.\"user\"') native_users,to_regclass('internal.auth_identity_bindings') bindings,to_regclass('auth.users') source_auth_users")).rows[0].native_users,null);
 await c.query('COMMIT');console.log(JSON.stringify({status:'PASS',role:login,sourceAccountInventory:s.authMetadata.length,newNativeAuthUsers:0,identityMappingsCreated:0,signupProvisioningEnabled:false,privateCredentials:file}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{await c.end();}
