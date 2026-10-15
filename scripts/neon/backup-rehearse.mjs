import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {parse} from 'dotenv';
import {loadBackup,restoreTarget,privateFile,sha} from './backup-common.mjs';
const {snapshot:s,ciphertextSha256,file}=await loadBackup();
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'newhope-backup-negative-'));
const selection=process.env.NEON_RESTORE_TARGET||'full-restore';
const original=fs.readFileSync(selection==='fresh-candidate'?'.env.neon-fresh-candidate.local':selection==='clean-rehearsal'?'.env.neon-clean-restore.local':'.env.neon-data-restore.local','utf8');
const results={status:'RUNNING',scope:'Private encrypted scoped capture validation and target/secret guard negative tests; no database writes',ciphertextSha256,checks:{}};
function envFile(change){const env={...parse(original),...change},f=path.join(temp,'target-'+Object.keys(change).join('-')+'.env');fs.writeFileSync(f,Object.entries(env).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n'),{mode:0o600});return f;}
try{
 assert.equal(restoreTarget().env.NEON_BRANCH_ID,restoreTarget().manifest.branchId);
 if(selection==='fresh-candidate'){
  assert.equal(ciphertextSha256,restoreTarget().manifest.ciphertextSha256);
  await assert.rejects(()=>loadBackup('build/neon/source-2026-10-13-v3.pgp.b64'),/FRESH_CAPTURE_REVIEW_MISMATCH/);
  results.checks.staleCaptureRejectedForFreshCandidate=true;
 }
 for(const change of [{NEON_PROJECT_ID:'unrelated-project'},{NEON_BRANCH_ID:'br-icy-dust-azqi5vlc'},{NEON_BRANCH_ID:'br-falling-butterfly-az989m86'},{NEON_RESTORE_HOST:'other.ap-southeast-1.aws.neon.tech'},{NEON_RESTORE_DATABASE_URL:'postgresql://synthetic:synthetic@other.ap-southeast-1.aws.neon.tech/neondb'}])assert.throws(()=>restoreTarget(envFile(change)));
 results.checks.wrongProjectBranchAndEndpointDenied=5;
 const permission=path.join(temp,'public-private-file');fs.writeFileSync(permission,'synthetic',{mode:0o644});assert.throws(()=>privateFile(permission));results.checks.insecureSecretFilePermissionsDenied=true;
 const originalCipher=Buffer.from(fs.readFileSync(file,'utf8'),'base64');originalCipher[Math.floor(originalCipher.length/2)]^=1;
 const tampered=path.join(temp,'tampered.pgp.b64');fs.writeFileSync(tampered,originalCipher.toString('base64'),{mode:0o600});await assert.rejects(()=>loadBackup(tampered));results.checks.ciphertextTamperingDenied=true;
 let residual=0;function scan(x){if(x&&typeof x==='object')for(const[k,v]of Object.entries(x)){if(/^(?:pin|password|password_hash|pin_hash|token|token_hash|secret|api_key|access_token|refresh_token)$/i.test(k))residual++;scan(v);}}
 for(const t of s.tables)for(const row of t.rows)scan(JSON.parse(row));assert.equal(residual,0);results.checks.residualCustomerCredentialKeys=0;
 assert(!Object.keys(s).some(k=>['authArchive','storageMetadata'].includes(k)));assert(s.authMetadata.every(a=>!Object.keys(a).some(k=>/password|hash|token|mfa|secret|session/i.test(k))));results.checks.authManifestContainsNoCredentials=true;
 assert(s.redactedNestedPaths?.some(p=>p.path==='snapshot.memberships[].pin'));results.checks.nestedRecoveryPinsExplicitlyRemoved=true;
 const raw=fs.readFileSync(file);assert(!raw.includes(Buffer.from('email_confirmed_at')));assert(!raw.includes(Buffer.from('memberships')));results.checks.backupStoredAsCiphertext=true;
 results.status='PASS';console.log(JSON.stringify(results));
}finally{fs.rmSync(temp,{recursive:true,force:true});fs.writeFileSync('build/neon/source-backup-negative-evidence.json',JSON.stringify(results,null,2)+'\n');}
