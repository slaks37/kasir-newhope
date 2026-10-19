import fs from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {createClient} from '@supabase/supabase-js';
import {createInterface} from 'node:readline/promises';
import {privateFile} from './backup-common.mjs';
const project='fqxrhumsgigcgjtlbfuo',origin='https://'+project+'.supabase.co';
const digest=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const dir='build/neon/private-identity-recovery';
export function validateSourceProof(challenge,token,user,now=Date.now()){
 const fail=code=>{throw Error(code);};
 if(!challenge||challenge.usedAt||!Number.isFinite(Date.parse(challenge.issuedAt))||!Number.isFinite(Date.parse(challenge.expiresAt))||Date.parse(challenge.expiresAt)<=now||Date.parse(challenge.issuedAt)>now+10000)fail('CHALLENGE_EXPIRED_OR_USED');
 let claims;try{claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());}catch{fail('INVALID_SOURCE_TOKEN');}
 // Call only AFTER the exact pinned source /auth/v1/user has accepted this token.
 // JWT claims alone never establish proof. Email and user_metadata are ignored.
 if(claims.iss!==origin+'/auth/v1'||claims.aud!=='authenticated'||claims.sub!==challenge.sourceUuid||user.id!==challenge.sourceUuid||!Number.isFinite(claims.exp)||claims.exp*1000<=now||!Number.isFinite(claims.iat)||claims.iat*1000<Date.parse(challenge.issuedAt)-10000||claims.iat*1000>now+10000)fail('SOURCE_SUBJECT_OR_FRESHNESS_MISMATCH');
 const fresh=(claims.amr||[]).some(a=>['password','oauth','totp','mfa'].includes(a.method)&&Number.isFinite(a.timestamp)&&a.timestamp*1000>=Date.parse(challenge.issuedAt)-10000&&a.timestamp*1000<=now+10000);
 if(!fresh)fail('FRESH_REAUTHENTICATION_REQUIRED');
 const sourceHasMfa=(user.factors||[]).some(f=>f.status==='verified');if(sourceHasMfa&&claims.aal!=='aal2')fail('SOURCE_MFA_REQUIRED');
 if(user.banned_until&&Date.parse(user.banned_until)>now||user.deleted_at)fail('SOURCE_ACCOUNT_UNAVAILABLE');
 return {sourceSubjectVerified:true,freshReauthentication:true,sourceMfaSatisfied:!sourceHasMfa||claims.aal==='aal2',emailUsedAsOwnershipEvidence:false};
}
async function claimantSession(key){
 if(!process.stdin.isTTY)throw Error('CLAIMANT_INTERACTIVE_TTY_REQUIRED');
 const line=createInterface({input:process.stdin,output:process.stderr});const email=await line.question('Email akun sumber Anda: ');line.close();
 const secret=await new Promise((resolve,reject)=>{let value='';process.stderr.write('Password sumber (tersembunyi; tidak disimpan): ');process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');function finish(){process.stdin.off('data',input);process.stdin.setRawMode(false);process.stdin.pause();process.stderr.write('\n');}function input(s){for(const c of s){if(c==='\u0003'){finish();reject(Error('CANCELLED'));return;}if(c==='\r'||c==='\n'){finish();resolve(value);return;}if(c==='\u007f')value=value.slice(0,-1);else if(c>=' ')value+=c;}}process.stdin.on('data',input);});
 const client=createClient(origin,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 try{
  const signed=await client.auth.signInWithPassword({email,password:secret});if(signed.error||!signed.data.session)throw Error('SOURCE_PASSWORD_REAUTH_FAILED_USE_EXISTING_SOURCE_RECOVERY');
  let session=signed.data.session;
  const factors=await client.auth.mfa.listFactors();if(factors.error)throw Error('SOURCE_MFA_STATUS_UNAVAILABLE');
  const verified=factors.data.all.filter(f=>f.status==='verified');if(verified.length){const totp=verified.find(f=>f.factor_type==='totp');if(!totp)throw Error('USE_EXISTING_SOURCE_MFA_FLOW_NO_SMS_SENT');
   const prompt=createInterface({input:process.stdin,output:process.stderr});const code=await prompt.question('Kode TOTP dari perangkat Anda (tidak disimpan): ');prompt.close();
   const step=await client.auth.mfa.challengeAndVerify({factorId:totp.id,code});if(step.error)throw Error('SOURCE_MFA_NOT_VERIFIED');const current=await client.auth.getSession();session=current.data.session;if(!session)throw Error('SOURCE_MFA_SESSION_MISSING');
  }
  return {token:session.access_token,close:async()=>{const r=await client.auth.signOut({scope:'local'});if(r.error)throw Error('SOURCE_TEMP_SESSION_LOGOUT_NOT_CONFIRMED');}};
 }catch(e){await client.auth.signOut({scope:'local'});throw e;}
}
async function main(){
 const [mode,index,sessionFile]=process.argv.slice(2);if(!['prepare','issue','verify','claim'].includes(mode))throw Error('USE_PREPARE_ISSUE_VERIFY_OR_CLAIM');
 const report=JSON.parse(privateFile('build/neon/private-owner-identity-review.json'));
 if(report.exceptions.length!==3)throw Error('REVIEW_COUNT_CHANGED');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 if(mode==='prepare'){
  const packet={classification:'PRIVATE NEVER COMMIT',sourceProject:project,sourceReportSha256:digest(privateFile('build/neon/private-owner-identity-review.json')),cases:report.exceptions.map((e,i)=>({caseNumber:i+1,sourceUuid:e.sourceUuid,destinationUuid:e.destinationUuid,conflictingDestinationUuid:e.conflictingDestinationUuid,reason:e.reason,sourceAuthority:{tenants:e.tenants,memberships:e.memberships,merchants:e.merchants,outlets:e.outlets},sourceReauthRequired:true,conflictingCanonicalOwnerSeparateProofRequired:!!e.conflictingDestinationUuid,noActivation:true,recoverySteps:['Issue a fresh local challenge when claimant is present.','Claimant signs in to their own existing source account after challenge issuance, completes existing MFA and supplies access_token privately in a mode-600 session file. Never use service_role, refresh tokens, email links or customer passwords in chat.','Verify live pinned source user and fresh authentication. Recheck current authoritative tenant relationships read-only.','For a conflicting canonical UUID, require separately verified canonical-owner proof and an exact permission impact decision. Source possession alone never proves both identities.','Keep account inactive unless ownership and exact business authority are established. Use reviewed append-only resolution; no automatic mapping.']}))};
  fs.writeFileSync(dir+'/owner-packet.json',JSON.stringify(packet,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:'READY_FOR_CLAIMANT_REAUTH',privatePacket:dir+'/owner-packet.json',cases:3,activationOperations:0}));return;
 }
 if(!/^[123]$/.test(index||''))throw Error('EXACT_CASE_NUMBER_REQUIRED');
 const e=report.exceptions[Number(index)-1],file=dir+'/challenge-'+index+'.json';
 if(mode==='issue'){
  if(fs.existsSync(file)){const old=JSON.parse(privateFile(file));if(!old.usedAt&&Date.parse(old.expiresAt)>Date.now())throw Error('EXISTING_UNEXPIRED_CHALLENGE');}
  const c={version:1,sourceProject:project,caseNumber:Number(index),sourceUuid:e.sourceUuid,reason:e.reason,nonce:randomBytes(32).toString('base64url'),issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+15*60*1000).toISOString(),reportSha256:digest(privateFile('build/neon/private-owner-identity-review.json')),authoritySha256:digest({tenants:e.tenants,memberships:e.memberships,merchants:e.merchants,outlets:e.outlets})};
  fs.writeFileSync(file,JSON.stringify(c,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:'CHALLENGE_ISSUED',caseNumber:Number(index),expiresAt:c.expiresAt,privateFile:file,activationOperations:0}));return;
 }
 let challenge=JSON.parse(privateFile(file));if(challenge.reportSha256!==digest(privateFile('build/neon/private-owner-identity-review.json')))throw Error('REVIEW_EVIDENCE_CHANGED');
 const env=parse(privateFile('.env.identity-recovery.local'));
 const key=env.VITE_SUPABASE_ANON_KEY||env.SUPABASE_ANON_KEY||env.VITE_SUPABASE_PUBLISHABLE_KEY;if(!key)throw Error('SOURCE_PUBLIC_API_KEY_REQUIRED');
 if(!key.startsWith('sb_publishable_')){let role;try{role=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role;}catch{}if(role!=='anon')throw Error('SOURCE_PUBLIC_KEY_ONLY');}
 const lock=fs.openSync(file+'.lock','wx',0o600);let login;try{
 challenge=JSON.parse(privateFile(file));
 if(challenge.reportSha256!==digest(privateFile('build/neon/private-owner-identity-review.json')))throw Error('REVIEW_EVIDENCE_CHANGED');
 if(challenge.usedAt||Date.parse(challenge.expiresAt)<=Date.now())throw Error('CHALLENGE_EXPIRED_OR_USED');
 const input=mode==='claim'?{nonce:challenge.nonce,access_token:(login=await claimantSession(key)).token}:JSON.parse(privateFile(sessionFile));
 if(input.nonce!==challenge.nonce||typeof input.access_token!=='string'||input.access_token.length>16000||Object.keys(input).some(k=>!['nonce','access_token'].includes(k)))throw Error('CLAIMANT_SESSION_INPUT_INVALID');
 const response=await fetch(origin+'/auth/v1/user',{headers:{apikey:key,authorization:'Bearer '+input.access_token},redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('SOURCE_SESSION_NOT_ACCEPTED');
 const proof=validateSourceProof(challenge,input.access_token,await response.json());
 // Receipt deliberately has no UUID, email, token, nonce or business identifiers.
 const receipt={status:'SOURCE_POSSESSION_ONLY_AUTHORITY_REVIEW_REQUIRED',checkedAt:new Date().toISOString(),caseNumber:Number(index),challengeSha256:digest(challenge),authoritySha256:challenge.authoritySha256,...proof,currentTenantAuthorityRecheckRequired:true,conflictingCanonicalProofRequired:!!e.conflictingDestinationUuid,identityActivated:false,permissionChanges:0};
 fs.writeFileSync(dir+'/proof-'+index+'.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600});challenge.usedAt=receipt.checkedAt;fs.writeFileSync(file,JSON.stringify(challenge,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(receipt));
 }finally{try{await login?.close();}finally{fs.closeSync(lock);fs.unlinkSync(file+'.lock');}}
}
if(process.argv[1]&&new URL(import.meta.url).pathname===fs.realpathSync(process.argv[1]))main().catch(e=>{console.error(JSON.stringify({status:'BLOCKED',code:/^[A-Z_0-9]+$/.test(e.message)?e.message:'IDENTITY_RECOVERY_FAILED',secretsOmitted:true,identityActivated:false}));process.exitCode=2;});
