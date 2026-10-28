// Disposable CI database only. Never accepts production/cloud connection URLs.
// Backup contains synthetic fixture credentials only; key and plaintext dump
// stay in memory. Only bounded credential-free evidence is uploaded.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {rehearsalTarget} from './rehearsal-target.mjs';
import {planAuthIdentityMigration,applyAuthIdentityMigration,revokeAuthIdentityMigration,resolveAuthIdentity,authIdentityBusinessFingerprint} from '../../services/shared/authIdentity.ts';
const target=rehearsalTarget(process.env),source=new pg.Client({connectionString:target,ssl:false});
const restoredUrl=new URL(target);restoredUrl.pathname='/newhope_auth_restore_rehearsal';
const restored=new pg.Client({connectionString:restoredUrl.href,ssl:false});
const evidence={revision:process.env.GITHUB_SHA||'local',status:'RUNNING',scope:'Disposable PostgreSQL17 synthetic fixtures only; no real provider credentials or production access',checks:{}};
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const wrap=c=>({query:async(sql,params)=>{const r=await c.query(sql,params);return {rows:r.rows,rowCount:r.rowCount||0};},exec:async sql=>{await c.query(sql);},tx:async fn=>{await c.query('BEGIN');try{const v=await fn(wrap(c));await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}},close:()=>c.end()});
const command=(binary,args,input)=>{const r=spawnSync(binary,args,{input,maxBuffer:64*1024*1024});if(r.status!==0)throw Error('Disposable backup command failed: '+binary+' '+String(r.status));return r.stdout;};
async function snapshot(c){
 const tables=(await c.query("SELECT n.nspname AS schema,c.relname AS name,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced,pg_get_userbyid(c.relowner) AS owner,ARRAY(SELECT v::text FROM unnest(c.relacl) v ORDER BY 1)::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND c.relkind IN('r','p') ORDER BY n.nspname,c.relname")).rows;
 const data=[];for(const table of tables){const rows=(await c.query('SELECT to_jsonb(t)::text AS value FROM '+quote(table.schema)+'.'+quote(table.name)+' t ORDER BY 1')).rows;data.push([table.schema,table.name,rows.length,hash(JSON.stringify(rows))]);}
 const policies=(await c.query("SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname NOT LIKE 'pg_%' ORDER BY schemaname,tablename,policyname")).rows;
 const functions=(await c.query("SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS signature,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) AS definition,ARRAY(SELECT v::text FROM unnest(p.proacl) v ORDER BY 1)::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND p.prokind IN('f','p') ORDER BY n.nspname,p.proname,signature")).rows;
 const objects=(await c.query("SELECT n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner) AS owner,ARRAY(SELECT v::text FROM unnest(c.relacl) v ORDER BY 1)::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND c.relkind IN('v','m','S') ORDER BY 1,2")).rows;
 const schemas=(await c.query("SELECT nspname,pg_get_userbyid(nspowner) AS owner,ARRAY(SELECT v::text FROM unnest(nspacl) v ORDER BY 1)::text AS acl FROM pg_namespace WHERE nspname NOT IN('pg_catalog','information_schema') AND nspname NOT LIKE 'pg_%' ORDER BY 1")).rows;
 const sequences=[];for(const s of (await c.query("SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname NOT LIKE 'pg_%' ORDER BY 1,2")).rows)sequences.push([s.schemaname,s.sequencename,(await c.query('SELECT last_value::text,is_called FROM '+quote(s.schemaname)+'.'+quote(s.sequencename))).rows]);
 return {tables:tables.length,rows:data.reduce((n,row)=>n+row[2],0),data:hash(JSON.stringify(data)),security:hash(JSON.stringify([tables,policies,functions,objects,schemas])),sequences:hash(JSON.stringify(sequences)),securityDetails:{tables,policies,functions,objects,schemas}};
}
let created=false,connected=false;const key=randomBytes(32);
await source.connect();
try{
 assert.equal(Math.floor(Number((await source.query('SHOW server_version_num')).rows[0].server_version_num)/10000),17);
 assert.equal((await source.query("SELECT count(*)::int AS n FROM internal.staff_access_events")).rows[0].n>0,true,'Require completed synthetic staff acceptance before backup');
 assert.equal((await source.query('SELECT 1 FROM pg_database WHERE datname=$1',['newhope_auth_restore_rehearsal'])).rows.length,0,'Never overwrite an existing restore database');
 const ids=command('docker',['ps','--filter','ancestor=postgres:17','--format','{{.ID}}']).toString().trim().split('\n').filter(Boolean);assert.equal(ids.length,1,'Require one unambiguous disposable PG17 service container');
 const container=ids[0];const ports=JSON.parse(command('docker',['inspect','--format','{{json .NetworkSettings.Ports}}',container]).toString());assert(ports['5432/tcp'].some(p=>p.HostPort===String(new URL(target).port)),'Container must own the approved disposable target port');
 // Private bytes below are deliberately invalid synthetic credentials. This is
 // restore fidelity, not provider login/MFA acceptance or production key escrow.
 const providerSubject='backup-fixture-'+randomUUID();
 await source.query('INSERT INTO newhope_auth."user"(id,name,email,"emailVerified","isActive") VALUES($1,$2,$3,true,true)',[providerSubject,'Synthetic backup account',providerSubject+'@fixture.invalid']);
 await source.query('INSERT INTO newhope_auth."account"(id,"accountId","providerId","userId",password,"updatedAt") VALUES($1,$2,$3,$2,$4,now())',[randomUUID(),providerSubject,'credential','invalid-synthetic-backup-hash']);
 await source.query('INSERT INTO newhope_auth."twoFactor"(id,secret,"backupCodes","userId",verified) VALUES($1,$2,$3,$4,true)',[randomUUID(),'invalid-synthetic-encrypted-mfa','invalid-synthetic-backup-codes',providerSubject]);
 await source.query('INSERT INTO newhope_auth.session(id,"expiresAt",token,"updatedAt","userId") VALUES($1,now()+interval \'1 hour\',$2,now(),$3)',[randomUUID(),'invalid-synthetic-session-'+randomUUID(),providerSubject]);
 const canonical=(await source.query('SELECT owner_user_ref FROM internal.tenants WHERE owner_user_ref ~ $1 ORDER BY id LIMIT 1',['^[0-9a-f-]{36}$'])).rows[0].owner_user_ref;
 const db=wrap(source),businessBefore=await authIdentityBusinessFingerprint(db);
 const manifest={version:1,provider:'better-auth',issuer:'https://auth.backup.fixture.invalid',sourceSnapshotDigest:businessBefore,reviewerRef:'synthetic-reviewed-mapping',freezeRef:'disposable-writers-frozen',mappings:[{providerSubject,canonicalSubject:canonical,evidenceRef:'synthetic-explicit-owner-proof'}]};
 const plan=await planAuthIdentityMigration(db,manifest);
 await applyAuthIdentityMigration(db,manifest,plan);assert.equal(await authIdentityBusinessFingerprint(db),businessBefore);
 const before=await snapshot(source);
 const dump=command('docker',['exec',container,'pg_dump','-U','postgres','-d',new URL(target).pathname.slice(1),'-Fc']);
 assert(dump.length>0&&dump.length<64*1024*1024);
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),ciphertext=Buffer.concat([cipher.update(dump),cipher.final()]),tag=cipher.getAuthTag();
 const decrypt=(cipherKey,bytes)=>{const decipher=createDecipheriv('aes-256-gcm',cipherKey,iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(bytes),decipher.final()]);};
 assert.throws(()=>decrypt(randomBytes(32),ciphertext));const tampered=Buffer.from(ciphertext);tampered[0]^=1;assert.throws(()=>decrypt(key,tampered));
 const plain=decrypt(key,ciphertext);assert.equal(hash(plain),hash(dump));
 await source.query('CREATE DATABASE newhope_auth_restore_rehearsal');created=true;
 command('docker',['exec','-i',container,'pg_restore','-U','postgres','-d','newhope_auth_restore_rehearsal','--exit-on-error','--clean','--if-exists'],plain);
 plain.fill(0);dump.fill(0);await restored.connect();connected=true;
 const after=await snapshot(restored);
 if(after.security!==before.security){
  const differences=[];
  for(const kind of Object.keys(before.securityDetails)){
   const left=before.securityDetails[kind],right=after.securityDetails[kind];
   for(let i=0;i<Math.max(left.length,right.length);i++)if(JSON.stringify(left[i])!==JSON.stringify(right[i])){
    const a=left[i]||{},b=right[i]||{},fields=Object.keys({...a,...b}).filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]));
    differences.push({kind,object:a.name||a.proname||a.tablename||a.relname||a.nspname,fields,...(fields.includes('acl')?{beforeAcl:a.acl,afterAcl:b.acl}:{}),...(fields.includes('owner')?{beforeOwner:a.owner,afterOwner:b.owner}:{}),...(kind==='policies'?{beforeQual:a.qual,afterQual:b.qual,beforeCheck:a.with_check,afterCheck:b.with_check}:{})});
   }
  }
  evidence.securityDifferences=differences.slice(0,20);console.log('Bounded restore security metadata differences',JSON.stringify(evidence.securityDifferences));
 }
 const summary=({securityDetails,...value})=>value;
 assert.deepEqual(summary(after),summary(before),'Data, sequences, RLS, policies, helper owners and ACLs must survive restore');
 const restoreDb=wrap(restored),input={provider:'better-auth',issuer:manifest.issuer,subject:providerSubject,email:providerSubject+'@fixture.invalid',isEmailVerified:true};
 assert.equal(await resolveAuthIdentity(restoreDb,input),canonical);assert.equal(await authIdentityBusinessFingerprint(restoreDb),businessBefore);
 await assert.rejects(()=>revokeAuthIdentityMigration(restoreDb,'0'.repeat(64),'fixture-reviewed-rollback','unknown-batch'),/AUTH_IDENTITY/);
 assert.equal(await resolveAuthIdentity(restoreDb,input),canonical,'Failed rollback cannot disable a different mapping');
 await revokeAuthIdentityMigration(restoreDb,plan.manifestDigest,'fixture-reviewed-rollback','synthetic-provider-rollback');
 await restored.query('DELETE FROM newhope_auth.session WHERE "userId"=$1',[providerSubject]);
 assert.equal(await resolveAuthIdentity(restoreDb,input),null);assert.equal(await authIdentityBusinessFingerprint(restoreDb),businessBefore,'Rollback cannot rewrite business ownership, staff grants or historical ledgers');
 await assert.rejects(()=>applyAuthIdentityMigration(restoreDb,manifest,plan),/AUTH_IDENTITY/);
 evidence.status='PASS';evidence.snapshot={tables:before.tables,rows:before.rows,dataDigest:before.data};evidence.encryptedBackupDigest=hash(Buffer.concat([iv,tag,ciphertext]));
 evidence.checks={pgDump17:'PASS',authenticatedEncryption:'PASS',wrongKeyAndTamperDenied:'PASS',restoreDataSequencesSecurity:'PASS',explicitMapping:'PASS',rollbackAndForcedReauthentication:'PASS',rollbackFailureClosed:'PASS',financialActorsPreserved:'PASS'};
 console.log('PASS disposable PG17 encrypted backup/restore, exact rows/sequences/RLS/helper owners/ACLs, explicit identity migration and rollback with forced reauthentication; no hosted-provider or production escrow claim');
}catch(e){evidence.status='FAIL';evidence.failure={name:e.name,code:e.code,message:e.message};throw e;}
finally{
 key.fill(0);if(connected)await restored.end();if(created)await source.query('DROP DATABASE newhope_auth_restore_rehearsal');await source.end();
 fs.mkdirSync('build/auth-backup-rehearsal',{recursive:true});fs.writeFileSync('build/auth-backup-rehearsal/postgres17.json',JSON.stringify(evidence,null,2)+'\n');
}
