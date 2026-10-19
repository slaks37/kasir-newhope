import fs from 'node:fs';
import {loadBackup} from './backup-common.mjs';
const {snapshot,ciphertextSha256}=await loadBackup();
const canonical=snapshot.tables.find(t=>t.schema==='internal'&&t.name==='users').rows.map(r=>JSON.parse(r));
const mismatches=[];
const collisionCount=snapshot.authMetadata.filter(a=>!canonical.some(c=>c.id===a.id)&&canonical.some(c=>c.email?.trim().toLowerCase()===a.email?.trim().toLowerCase())).length;
const users=snapshot.authMetadata.map(a=>{
 const c=canonical.find(u=>u.id===a.id);
 const email=a.email?.trim().toLowerCase();
 if(!c||c.email?.trim().toLowerCase()!==email||a.deleted_at||a.is_sso_user||a.banned_until&&Date.parse(a.banned_until)>Date.now())mismatches.push({reason:!c?'CANONICAL_ID_ABSENT':c.email?.trim().toLowerCase()!==email?'CANONICAL_EMAIL_DIFFERS':a.is_sso_user?'SSO_REVIEW_REQUIRED':'DISABLED_IDENTITY_REVIEW'});
 return {id:a.id,email,emailVerified:Boolean(a.email_confirmed_at),isActive:c?.is_active!==false&&!a.deleted_at&&!(a.banned_until&&Date.parse(a.banned_until)>Date.now()),name:(a.name||c?.full_name||'New Hope user').slice(0,200)};
});
const manifest={version:1,sourceProject:snapshot.sourceProject,backupRef:ciphertextSha256,reviewerRef:'OWNER_REQUEST_FULL_NEON_PREPARATION_20261013',users};
fs.writeFileSync('build/neon/identity-source-manifest.json',JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
fs.writeFileSync('build/neon/identity-source-readiness.json',JSON.stringify({status:mismatches.length?'REVIEW_REQUIRED':'READY_FOR_REVIEW',sourceAuthUsers:users.length,canonicalUsers:canonical.length,verified:users.filter(u=>u.emailVerified).length,active:users.filter(u=>u.isActive).length,mismatches,canonicalEmailCollisions:collisionCount,backupRef:ciphertextSha256},null,2)+'\n');
console.log(JSON.stringify({status:mismatches.length?'REVIEW_REQUIRED':'READY_FOR_REVIEW',users:users.length,canonicalUsers:canonical.length,mismatches:mismatches.length,plaintextManifest:'PRIVATE_0600_IGNORED'}));
