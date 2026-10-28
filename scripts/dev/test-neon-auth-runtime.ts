import assert from 'node:assert/strict';
import fs from 'node:fs';
import {migrationFiles} from '../db/migration-files.mjs';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {createOTP} from '@better-auth/utils/otp';
import {base32} from '@better-auth/utils/base32';
import {getMigrations} from 'better-auth/db/migration';
import {resetSchemaFeatureCache} from '../../services/shared/schemaFeatures';
import {createBetterAuthRuntime} from '../../services/shared/betterAuth';
import {getAuthConfig} from '../../services/shared/betterAuthConfig';
import {createNeonAuthHandler} from '../../src/server/neonAuthHandler';
import {sealAuthState,openAuthState} from '../../services/shared/nativeAuthState';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {offlineIdentityKeys} from '../../services/shared/offlineIdentity';
import {verifyOfflineIdentity} from '../../src/lib/auth/offlineIdentity';
const pg=new PGlite();await pg.exec('CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;');
for(const file of migrationFiles())await pg.exec(fs.readFileSync(file.path,'utf8'));
const wire=new PGLiteSocketServer({db:pg,port:0,host:'127.0.0.1',maxConnections:6});await wire.start();
const base='https://auth.fixture.invalid';Object.assign(process.env,{NODE_ENV:'test',APP_ENV:'staging',AUTH_PROVIDER:'neon',NEWHOPE_NEON_AUTH_STAGING:'1',NEWHOPE_AUTH_URL:base,BETTER_AUTH_SECRET:'synthetic-runtime-secret-'.repeat(4),BETTER_AUTH_DATABASE_URL:'postgresql://postgres:postgres@'+wire.getServerConn()+'/postgres',DATABASE_URL:'postgresql://postgres:postgres@'+wire.getServerConn()+'/postgres',NEW_HOPE_NATIVE_ORIGINS:'capacitor://localhost'});
const mail:Array<{url:string;kind:string}>=[],runtime=createBetterAuthRuntime(getAuthConfig(),async m=>{mail.push(m);});
const app=express();app.use(createNeonAuthHandler(()=>runtime));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const origin='http://127.0.0.1:'+(server.address() as any).port;
let cookie='';
async function call(path:string,body?:any,extra:Record<string,string>={}){
 const response=await fetch(origin+'/api/auth'+path,{method:body===undefined?'GET':'POST',headers:{origin:base,'content-type':'application/json',...(cookie?{cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 for(const item of response.headers.getSetCookie()){const part=item.split(';')[0],name=part.split('=')[0];cookie=cookie.split('; ').filter(c=>!c.startsWith(name+'=')).concat(part).filter(Boolean).join('; ');}
 return response;
}
try{
 const plan=await getMigrations(runtime.auth.options);assert.equal(plan.toBeCreated.length,0,'Pinned auth schema has every runtime table');assert.equal(plan.toBeAdded.length,0,'Pinned auth schema has every field');
 await pg.exec('ALTER FUNCTION internal.is_staff_only_identity(text) RENAME TO unavailable_staff_identity_probe');resetSchemaFeatureCache();
 assert.equal((await call('/sign-up/email',{email:'blocked-staff@fixture.invalid',password:'Synthetic-Password-For-Tests-2026',name:'Blocked staff',callbackURL:base+'/login',onboarding:{account_purpose:'STAFF'}})).status,503);
 assert.equal((await pg.query<{n:number}>(`SELECT count(*)::int AS n FROM newhope_auth."user" WHERE email='blocked-staff@fixture.invalid'`)).rows[0].n,0,'Migration missing: no unprotected staff signup');
 await pg.exec('ALTER FUNCTION internal.unavailable_staff_identity_probe(text) RENAME TO is_staff_only_identity');resetSchemaFeatureCache();
 assert.equal((await call('/sign-up/email',{email:'new-user@fixture.invalid',password:'Synthetic-Password-For-Tests-2026',name:'Synthetic User',callbackURL:base+'/login',onboarding:{full_name:'Synthetic staff',account_purpose:'STAFF'}})).status,200);assert.equal(mail.length,1);
 const verify=new URL(mail[0].url);const verified=await fetch(origin+verify.pathname+verify.search,{headers:{origin:base},redirect:'manual'});assert(verified.status<400);
 const login=await call('/sign-in/email',{email:'new-user@fixture.invalid',password:'Synthetic-Password-For-Tests-2026'});assert.equal(login.status,200);const signed=cookie.split('; ').find(v=>v.includes('session_token='))?.split('=').slice(1).join('=');assert(signed);
 const identity=await (await call('/identity')).json();assert.match(identity.user.id,/^[a-f0-9-]{36}$/);assert.equal(identity.user.emailVerified,true);assert.equal(identity.user.passwordCredential,true);
 assert.equal((await pg.query<{auth_staff_only:boolean}>('SELECT auth_staff_only FROM internal.users WHERE id=$1',[identity.user.id])).rows[0].auth_staff_only,true,'Real staff signup is durably restricted before invitation acceptance');
 const offlineDevice=randomUUID(),receiptIdentity=await (await call('/identity',undefined,{'x-newhope-offline-device':offlineDevice})).json();
 const offlineClaims=await verifyOfflineIdentity(receiptIdentity.offlineReceipt,offlineIdentityKeys(getAuthConfig().secret,base).publicKey,base,offlineDevice);
 assert.equal(offlineClaims.sub,identity.user.id);assert.equal(offlineClaims.sid,identity.session.id);
 assert.equal((await call('/identity',undefined,{authorization:'Bearer '+receiptIdentity.offlineReceipt})).status,401,'A signed offline UI receipt cannot authenticate an API request');
 assert.equal((await call('/identity',undefined,{'x-newhope-offline-device':'forged-device'})).status,400);
 const provider=(await runtime.pool.query('SELECT id FROM newhope_auth."user"')).rows[0].id;assert.notEqual(provider,identity.user.id,'Canonical UUID is independent from provider ID');assert.equal((await pg.query<{n:number}>('SELECT count(*)::int AS n FROM internal.tenants')).rows[0].n,0);
 assert.equal((await call('/identity',undefined,{authorization:'Bearer forged'})).status,401,'Never downgrade a forged bearer to another cookie session');
 // Mutations obey the same explicit-bearer principal rule as identity.
 const mutationHeaders={origin:base,'content-type':'application/json',cookie,authorization:'Bearer forged'};
 for(const [route,body] of [['/two-factor/enable',{password:'Synthetic-Password-For-Tests-2026'}],['/revoke-sessions',{}]] as const){
  const denied=await fetch(origin+'/api/auth'+route,{method:'POST',headers:mutationHeaders,body:JSON.stringify(body)});assert.equal(denied.status,401);
 }
 await fetch(origin+'/api/auth/sign-out',{method:'POST',headers:mutationHeaders,body:'{}'});
 assert.equal((await call('/identity')).status,200,'Invalid bearer signout must leave the separate cookie principal active');
 for(const route of ['/get-access-token','/refresh-token','/account-info','/link-social','/unlink-account']){
  for(const spelling of [route,route+'/',route.replace('/g','/%67').replace('/r','/%72').replace('/a','/%61').replace('/l','/%6c').replace('/u','/%75')])assert.equal((await call(spelling,{provider:'google'})).status,404);
 }
 const enabled=await (await call('/two-factor/enable',{password:'Synthetic-Password-For-Tests-2026'})).json();assert(enabled.totpURI&&enabled.backupCodes?.length);const otp=createOTP(base32.decode(new URL(enabled.totpURI).searchParams.get('secret')!));
 assert.equal((await call('/two-factor/verify-totp',{code:await otp.totp(),trustDevice:false})).status,200);
 const stepUp=await (await call('/identity')).json();assert.equal(stepUp.session.aal,'aal2');assert(stepUp.session.mfaVerifiedAt>0);
 // Synthetic Google-only first-factor fixture uses the real engine. No real
 // Google login is claimed by this fixture. Existing secrets cannot supply MFA.
 const credential=(await runtime.pool.query(`SELECT id,password FROM newhope_auth.account WHERE "userId"=$1 AND "providerId"='credential'`,[provider])).rows[0];
 const originalProof=(await runtime.pool.query('SELECT method,verified_at FROM newhope_auth.mfa_session_proofs WHERE session_id=$1',[stepUp.session.id])).rows[0];
 try{
  await runtime.pool.query(`UPDATE newhope_auth.account SET "providerId"='google',password=NULL WHERE id=$1`,[credential.id]);
  for(const evidence of [{method:null,age:-30},{method:'recovery',age:-30},{method:'totp',age:-601},{method:'totp',age:90}]){
   // Independent policy cases reset only synthetic throttle state so the
   // upstream three-request limit does not mask authorization. Runtime limits stay enabled.
   await runtime.pool.query('DELETE FROM newhope_auth."rateLimit"');
   await runtime.pool.query('DELETE FROM newhope_auth.mfa_session_proofs WHERE session_id=$1',[stepUp.session.id]);
   if(evidence.method)await runtime.pool.query("INSERT INTO newhope_auth.mfa_session_proofs(session_id,user_id,method,verified_at) VALUES($1,$2,$3,now()+$4*interval '1 second')",[stepUp.session.id,provider,evidence.method,evidence.age]);
   for(const [route,body] of [['/two-factor/get-totp-uri',{}],['/change-password',{currentPassword:'Synthetic-Password-For-Tests-2026',newPassword:'Synthetic-Changed-Password-For-Tests-2026'}],['/revoke-session',{token:'unrelated-session-token'}],['/revoke-sessions',{}],['/revoke-other-sessions',{}],['/list-sessions',undefined]] as const){
    const denied=await call(route,body);assert.equal(denied.status,403,route+': '+JSON.stringify(evidence));assert.equal((await denied.json()).code,'REAUTH_REQUIRED');
   }
  }
 }finally{
  await runtime.pool.query('DELETE FROM newhope_auth."rateLimit"');
  await runtime.pool.query(`UPDATE newhope_auth.account SET "providerId"='credential',password=$2 WHERE id=$1`,[credential.id,credential.password]);
  await runtime.pool.query('DELETE FROM newhope_auth.mfa_session_proofs WHERE session_id=$1',[stepUp.session.id]);
  await runtime.pool.query('INSERT INTO newhope_auth.mfa_session_proofs(session_id,user_id,method,verified_at) VALUES($1,$2,$3,$4)',[stepUp.session.id,provider,originalProof.method,originalProof.verified_at]);
 }
 assert.equal((await call('/two-factor/get-totp-uri',{password:'Synthetic-Password-For-Tests-2026'})).status,200);
 assert.equal((await call('/list-sessions')).status,200);
 assert.equal((await call('/revoke-other-sessions',{})).status,200);
 const extraSession=await (await runtime.auth.$context).internalAdapter.createSession(provider);assert(extraSession);
 assert.equal((await call('/revoke-session',{token:extraSession.token})).status,200);assert.equal((await runtime.pool.query('SELECT id FROM newhope_auth.session WHERE id=$1',[extraSession.id])).rows.length,0);
 const temporaryPassword='Synthetic-Temporary-Password-For-Tests-2026';
 assert.equal((await call('/change-password',{currentPassword:'Synthetic-Password-For-Tests-2026',newPassword:temporaryPassword})).status,200);
 assert.equal((await call('/change-password',{currentPassword:temporaryPassword,newPassword:'Synthetic-Password-For-Tests-2026'})).status,200);
 // Native handoff consumes one code only, with PKCE and a live session check.
 const sessionCookie=cookie.split('; ').find(v=>v.includes('session_token='))!.split('=').slice(1).join('='),code=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),hash=(v:string)=>createHash('sha256').update(v).digest('base64url'),tx=randomBytes(32).toString('base64url');
 await runtime.pool.query("INSERT INTO newhope_auth.native_transactions(id,challenge,expires_at,completed_at) VALUES($1,$2,now()+interval '5 minutes',now())",[tx,hash(verifier)]);
 await runtime.pool.query("INSERT INTO newhope_auth.native_handoffs(code_hash,transaction_id,token_encrypted,expires_at) VALUES($1,$2,$3,now()+interval '60 seconds')",[hash(code),tx,sealAuthState(sessionCookie,getAuthConfig().secret,'native-session:'+base,60)]);
 assert.equal((await call('/native/exchange',{code,verifier:'x'.repeat(43)},{origin:'capacitor://localhost'})).status,401);
 const exchanges=await Promise.all([call('/native/exchange',{code,verifier},{origin:'capacitor://localhost'}),call('/native/exchange',{code,verifier},{origin:'capacitor://localhost'})]);assert.deepEqual(exchanges.map(r=>r.status).sort(),[200,401]);assert(exchanges.find(r=>r.status===200)!.headers.get('set-auth-token'));
 await call('/sign-out',{});assert.equal((await call('/identity',undefined,{authorization:'Bearer '+signed})).status,401);
 // Real native-origin pending challenge and signed bearer, with no session
 // cookie relay. An unrelated bearer cannot discard the sealed pending challenge.
 const nativeLogin=await fetch(origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin:'capacitor://localhost','content-type':'application/json'},body:JSON.stringify({email:'new-user@fixture.invalid',password:'Synthetic-Password-For-Tests-2026'})});
 assert.equal(nativeLogin.status,200);assert.equal((await nativeLogin.json()).twoFactorRedirect,true);assert(!nativeLogin.headers.get('set-auth-token'));
 const nativeState=nativeLogin.headers.get('x-newhope-auth-state');assert(nativeState);assert.equal(nativeLogin.headers.getSetCookie().length,0);
 const nativeTotp=await fetch(origin+'/api/auth/two-factor/verify-totp',{method:'POST',headers:{origin:'capacitor://localhost','content-type':'application/json','x-newhope-auth-state':nativeState,authorization:'Bearer forged'},body:JSON.stringify({code:await otp.totp(),trustDevice:false})});
 assert.equal(nativeTotp.status,200);const nativeToken=nativeTotp.headers.get('set-auth-token');assert(nativeToken);
 const nativeIdentity=await fetch(origin+'/api/auth/identity',{headers:{origin:'capacitor://localhost',authorization:'Bearer '+nativeToken}});assert.equal(nativeIdentity.status,200);const nativeValue=await nativeIdentity.json();assert.equal(nativeValue.user.id,identity.user.id);assert.equal(nativeValue.session.aal,'aal2');
 const newLogin=await call('/sign-in/email',{email:'new-user@fixture.invalid',password:'Synthetic-Password-For-Tests-2026'});assert.equal((await newLogin.json()).twoFactorRedirect,true);assert(!newLogin.headers.get('set-auth-token'),'MFA-pending password response cannot mint a bearer');
 assert.equal((await call('/two-factor/verify-backup-code',{code:enabled.backupCodes[0],trustDevice:false})).status,200);const recovered=await (await call('/identity')).json();assert.equal(recovered.session.aal,'aal1');assert(!recovered.session.mfaVerifiedAt,'Recovery codes never become fresh TOTP step-up');
 assert.equal((await call('/two-factor/disable',{password:'Synthetic-Password-For-Tests-2026'})).status,403,'Recovery proof cannot disable MFA');
 await call('/request-password-reset',{email:'new-user@fixture.invalid',redirectTo:base+'/reset-password'});const reset=new URL(mail.at(-1)!.url),token=reset.pathname.split('/').at(-1)!;
 assert.equal((await call('/reset-password',{token,newPassword:'Synthetic-Changed-Password-For-Tests-2026'})).status,200);assert.equal((await call('/identity')).status,401,'Password recovery revokes all existing sessions');
 assert.equal((await fetch(origin+'/api/auth/identity',{headers:{origin:'capacitor://localhost',authorization:'Bearer '+nativeToken}})).status,401,'Reset revokes the independent native bearer');
 assert.equal((await call('/sign-in/email',{email:'new-user@fixture.invalid',password:'Synthetic-Changed-Password-For-Tests-2026'})).status,200);
 assert.equal((await call('/two-factor/verify-totp',{code:await otp.totp(),trustDevice:false})).status,200);
 assert.equal((await call('/revoke-sessions',{})).status,200);assert.equal((await call('/identity')).status,401);
 const sealed=sealAuthState('pending',getAuthConfig().secret,'purpose',1,0);assert.equal(openAuthState(sealed,getAuthConfig().secret,'purpose',500),'pending');assert.throws(()=>openAuthState(sealed,getAuthConfig().secret,'other',500));assert.throws(()=>openAuthState(sealed,getAuthConfig().secret,'purpose',1000));
 console.log('PASS actual Better Auth + isolated SQL: schema parity, verified password signup, canonical identity, no duplicate tenant, session-bound TOTP/recovery, revoke/reset, PKCE one-use native handoff and state sealing. Email captured; Google and hosted/mobile provider sessions remain separate acceptance.');
}finally{await new Promise<void>(r=>server.close(()=>r()));await runtime.close();await wire.stop();await pg.close();}
