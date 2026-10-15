import fs from 'node:fs';import assert from 'node:assert/strict';import pg from 'pg';
import {loadBackup,restoreTarget,relation,sha,privateFile} from './backup-common.mjs';
const {manifest:target,...config}=restoreTarget();delete config.env;
assert(['br-curly-truth-aze21ktf','br-wandering-snow-azcqie4c'].includes(target.branchId),'HOLD_STAGING_TARGET_REQUIRED');
const report=JSON.parse(privateFile('build/neon/private-owner-identity-review.json'));
const {snapshot:s,ciphertextSha256}=await loadBackup('build/neon/source-2026-10-15-fresh.pgp.b64');assert.equal(ciphertextSha256,report.sourceBackupSha256);assert.equal(report.exceptions.length,3);
const c=new pg.Client(config);await c.connect();const evidence={status:'RUNNING',scope:'Owner-authorized separate inactive source identities; no guessed canonical mapping or business permission; no production changes',branchId:target.branchId,sourceBackupSha256:ciphertextSha256,startedAt:new Date().toISOString()};
const businessHash=async()=>{const result=[];for(const t of s.tables){const r=(await c.query("SELECT count(*)::int rows,encode(extensions.digest(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),''),'sha256'),'hex') fingerprint FROM "+relation(t)+' t')).rows[0];result.push({table:t.schema+'.'+t.name,...r});}return sha(JSON.stringify(result));};
try{
 assert(c.connection.stream.encrypted&&c.connection.stream.authorized);await c.query("BEGIN;SET LOCAL statement_timeout='120s'");const before=await businessHash();
 await c.query(fs.readFileSync('neon/migrations/0010_identity_review_holds.sql','utf8'));
 for(const e of report.exceptions){
  assert(!e.evidence.verifiedHumanOwnership);const source=s.authMetadata.find(a=>a.id===e.sourceUuid);assert(source);
  const existing=(await c.query('SELECT id,"isActive",lower(email)=lower($2) email_match FROM newhope_auth."user" WHERE id=$1 OR lower(email)=lower($2)',[source.id,source.email])).rows;
  assert(existing.every(u=>u.id===source.id&&!u.isActive&&u.email_match),'EXISTING_ACCOUNT_CONFLICT_REQUIRES_REVIEW');
  assert.equal((await c.query("SELECT count(*)::int n FROM internal.auth_identity_bindings WHERE provider_subject=$1 AND is_active",[source.id])).rows[0].n,0,'EXISTING_ACTIVE_BINDING_REQUIRES_REVIEW');
  await c.query('INSERT INTO newhope_auth.identity_review_holds(source_project,source_subject,conflicting_canonical_id,reason,source_backup_sha256,authorization_ref) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_subject) DO NOTHING',[s.sourceProject,source.id,e.conflictingDestinationUuid,e.reason,ciphertextSha256,'OWNER_AUTHORIZED_SAFE_SEPARATION_20261015']);
  if(!existing.length)await c.query('INSERT INTO newhope_auth."user"(id,name,email,"emailVerified","twoFactorEnabled","isActive") VALUES($1,$2,$3,$4,false,false)',[source.id,source.name||'Account awaiting verified recovery',source.email,!!source.email_confirmed_at]);
  for(const sql of ['UPDATE newhope_auth."user" SET "isActive"=true WHERE id=$1']){await c.query('SAVEPOINT denied');try{await c.query(sql,[source.id]);throw Error('HOLD_ACTIVATION_NOT_DENIED');}catch(err){await c.query('ROLLBACK TO SAVEPOINT denied');assert.equal(err.code,'42501');}await c.query('RELEASE SAVEPOINT denied');}
 }
 const after=await businessHash();assert.equal(after,before,'Business data and canonical permissions must remain unchanged');
 const totals=(await c.query('SELECT (SELECT count(*)::int FROM newhope_auth.identity_review_holds) holds,(SELECT count(*)::int FROM newhope_auth.identity_review_resolutions) resolutions,(SELECT count(*)::int FROM newhope_auth."user" u JOIN newhope_auth.identity_review_holds h ON h.source_subject::text=u.id WHERE u."isActive") active_held_users,(SELECT count(*)::int FROM internal.auth_identity_bindings b JOIN newhope_auth.identity_review_holds h ON h.source_subject::text=b.provider_subject WHERE b.is_active) active_held_bindings')).rows[0];assert.equal(totals.holds,3);assert.equal(totals.resolutions,0);assert.equal(totals.active_held_users,0);assert.equal(totals.active_held_bindings,0);
 await c.query('COMMIT');Object.assign(evidence,{status:'PASS',totals,originalBusinessFingerprint:before,businessUnchanged:true,canonicalAssignmentsChanged:0,activePermissionGrants:0,activationNegativeTests:3});console.log(JSON.stringify({status:'PASS',branchId:target.branchId,holds:3,inactiveSeparateIdentities:3,businessUnchanged:true,unverifiedActivationsDenied:3}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});evidence.status='FAIL';evidence.code=e.code||e.message;console.log(JSON.stringify({status:'FAIL',code:evidence.code}));process.exitCode=2;}
finally{await c.end();evidence.finishedAt=new Date().toISOString();fs.writeFileSync('build/neon/'+(target.branchId==='br-wandering-snow-azcqie4c'?'fresh-':'')+'identity-hold-evidence.json',JSON.stringify(evidence,null,2)+'\n');}
