import fs from 'node:fs';import assert from 'node:assert/strict';import pg from 'pg';
import {loadBackup,restoreTarget,relation,sha} from './backup-common.mjs';
if(process.env.NEON_RESTORE_TARGET!=='fresh-candidate')throw Error('FRESH_ISOLATED_CANDIDATE_REQUIRED');
const {snapshot:s}=await loadBackup(),{env,manifest,...config}=restoreTarget();
const files=['0001_identity_bindings.sql','0002_better_auth_core.sql','0003_better_auth_evidence.sql','0004_better_auth_identity_provider.sql','0005_runtime_roles.sql','0006_identity_import_audit.sql','0007_identity_canonical_create_evidence.sql','0009_native_onboarding_transport.sql'];
const c=new pg.Client(config),evidence={status:'RUNNING',scope:'Fresh isolated empty native auth schema and NOLOGIN role preparation; no identity import or activation, no source writes',targetBranch:manifest.branchId,startedAt:new Date().toISOString(),files:[]};
const fingerprint=async()=>{const rows=[];for(const t of s.tables){const r=(await c.query("SELECT count(*)::int rows,encode(extensions.digest(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),''),'sha256'),'hex') fingerprint FROM "+relation(t)+' t')).rows[0];rows.push({table:t.schema+'.'+t.name,...r});}return sha(JSON.stringify(rows));};
await c.connect();try{
 assert(c.connection.stream.encrypted&&c.connection.stream.authorized);
 await c.query("BEGIN; SET LOCAL statement_timeout='120s'; SET LOCAL lock_timeout='5s'");
 assert.equal((await c.query("SELECT to_regclass('newhope_auth.user')::text name")).rows[0].name,null,'REFUSE_EXISTING_NATIVE_AUTH_SCHEMA');
 const before=await fingerprint();
 for(const name of files){const path='neon/migrations/'+name,sql=fs.readFileSync(path,'utf8');await c.query(sql);evidence.files.push({path,sha256:sha(sql)});}
 const after=await fingerprint();assert.equal(after,before,'Original business rows must remain unchanged');
 const zero=(await c.query('SELECT (SELECT count(*)::int FROM newhope_auth."user") users,(SELECT count(*)::int FROM newhope_auth.account) accounts,(SELECT count(*)::int FROM newhope_auth.session) sessions,(SELECT count(*)::int FROM newhope_auth."twoFactor") mfa,(SELECT count(*)::int FROM internal.auth_identity_bindings) bindings,(SELECT count(*)::int FROM newhope_auth.identity_import_batches) imports')).rows[0];assert(Object.values(zero).every(n=>n===0));
 const roles=(await c.query("SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname IN('newhope_runtime','newhope_auth_runtime','newhope_migrator') ORDER BY rolname")).rows;
 assert.equal(roles.length,3);assert(roles.every(r=>!r.rolcanlogin&&!r.rolsuper&&!r.rolcreatedb&&!r.rolcreaterole&&!r.rolreplication&&!r.rolbypassrls));
 evidence.checks={allOriginalBusinessRowsPreserved:true,beforeFingerprint:before,afterFingerprint:after,originalTables:s.tables.length,nativeIdentityCounts:zero,roles,sourceWrites:0,customerIdentityChanges:0,loginCredentialsProvisioned:0};
 await c.query('COMMIT');evidence.status='PASS';console.log(JSON.stringify({status:'PASS',migrations:files.length,originalTablesUnchanged:s.tables.length,nativeIdentities:0,rolesNoLogin:3}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});evidence.status='FAIL';evidence.code=e.code||'ASSERTION';console.log(JSON.stringify({status:'FAIL',code:evidence.code,secretValuesOmitted:true}));process.exitCode=2;}
finally{await c.end();evidence.finishedAt=new Date().toISOString();fs.writeFileSync('build/neon/fresh-candidate-schema-evidence.json',JSON.stringify(evidence,null,2)+'\n');}
