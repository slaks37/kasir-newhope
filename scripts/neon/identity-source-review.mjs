import fs from 'node:fs';
import {loadBackup} from './backup-common.mjs';
import {validateIdentityManifest} from './identity-core.mjs';

// Derive review candidates only from the same encrypted source capture.
// This makes no target DB write and sends no recovery message.
const {snapshot,ciphertextSha256}=await loadBackup();
const rows=(schema,name)=>(snapshot.tables.find(t=>t.schema===schema&&t.name===name)?.rows||[]).map(r=>JSON.parse(r));
const canonical=rows('internal','users'),tenants=rows('internal','tenants'),pos=rows('pos','users'),legacy=rows('public','users');
const safe=[],creates=[],exceptions=[];
for(const a of snapshot.authMetadata) {
  const id=a.id,email=a.email?.trim().toLowerCase(),existing=canonical.find(u=>u.id===id);
  const flags=a.deleted_at||a.is_sso_user||(a.banned_until&&Date.parse(a.banned_until)>Date.now());
  const verified=Boolean(a.email_confirmed_at),active=!flags&&(!existing||existing.is_active===true);
  const uuidRefs={owners:tenants.filter(t=>t.owner_user_ref===id||t.owner_user_id===id).map(t=>t.id),pos:pos.filter(u=>u.id===id||u.external_ref===id).map(u=>u.id),legacy:legacy.filter(u=>u.id===id||u.external_ref===id).map(u=>u.id)};
  const collision=canonical.find(u=>u.id!==id&&u.email?.trim().toLowerCase()===email);
  let reason;
  if(flags)reason='SOURCE_DISABLED_OR_SSO_REVIEW_REQUIRED';
  else if(existing&&existing.email?.trim().toLowerCase()!==email)reason='CANONICAL_UUID_EMAIL_MISMATCH';
  else if(collision)reason='DIFFERENT_UUID_CANONICAL_EMAIL_COLLISION';
  else if(!existing&&!verified)reason='MISSING_CANONICAL_UNVERIFIED_SOURCE';
  else if(!existing&&!Object.values(uuidRefs).some(values=>values.length))reason='CANONICAL_UUID_EVIDENCE_MISSING';
  if(reason){exceptions.push({sourceId:id,reason,...(collision?{conflictingCanonicalId:collision.id}:{}),sourceUuidRefs:uuidRefs});continue;}
  safe.push({id,email,emailVerified:verified,isActive:active,name:(a.name||existing?.full_name||'New Hope user').slice(0,200)});
  if(!existing)creates.push(id);
}
const manifest={version:1,sourceProject:snapshot.sourceProject,backupRef:ciphertextSha256,reviewerRef:'AGENT_REVIEW_VERIFIED_SOURCE_UUID_CANDIDATES_20261014',users:safe,canonicalCreateIds:creates};
validateIdentityManifest(manifest);
fs.writeFileSync('build/neon/identity-reviewed-candidates.json',JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
fs.writeFileSync('build/neon/identity-review-exceptions.json',JSON.stringify({backupRef:ciphertextSha256,totalSourceUsers:snapshot.authMetadata.length,exceptions},null,2)+'\n',{mode:0o600});
const evidence={checkedAt:new Date().toISOString(),sourceProject:snapshot.sourceProject,sourceBackupSha256:ciphertextSha256,status:exceptions.length?'PARTIAL_CANDIDATES_REVIEW_REQUIRED':'ALL_CANDIDATES_REVIEW_REQUIRED',sourceAuthUsers:snapshot.authMetadata.length,candidates:safe.length,existingCanonical:safe.length-creates.length,explicitSourceUuidCreates:creates.length,exceptions:exceptions.map(e=>e.reason),scope:'Read-only candidate metadata; no target import, authority reassignment, email linking or messages'};
fs.writeFileSync('build/neon/identity-source-review-summary.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
