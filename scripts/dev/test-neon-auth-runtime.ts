import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {createOTP} from '@better-auth/utils/otp';
import {base32} from '@better-auth/utils/base32';
import {getMigrations} from 'better-auth/db/migration';
import {createBetterAuthRuntime} from '../../services/shared/betterAuth';
import {getAuthConfig} from '../../services/shared/betterAuthConfig';
import {createNeonAuthHandler} from '../../src/server/neonAuthHandler';
import {sealAuthState,openAuthState} from '../../services/shared/nativeAuthState';
import {createHash,randomBytes} from 'node:crypto';
const pg=new PGlite();await pg.exec('CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;');
for(const path of ['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f)])await pg.exec(fs.readFileSync(path,'utf8'));
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
 assert.equal((await call('/sign-up/email',{email:'new-user@fixture.invalid',password:'Synthetic-Password-For-Tests-2026',name:'Synthetic User',callbackURL:base+'/login',onboarding:{business_sector:'RETAIL',store_name:'Synthetic'}})).status,200);assert.equal(mail.length,1);
 const verify=new URL(mail[0].url);const verified=await fetch(origin+verify.pathname+verify.search,{headers:{origin:base},redirect:'manual'});assert(verified.status<400);
 const login=await call('/sign-in/email',{email:'new-user@fixture.invalid',password:'Synthetic-Password-For-Tests-2026'});assert.equal(login.status,200);const signed=cookie.split('; ').find(v=>v.includes('session_token='))?.split('=').slice(1).join('=');assert(signed);
 const identity=await (await call('/identity')).json();assert.match(identity.user.id,/^[a-f0-9-]{36}$/);assert.equal(identity.user.emailVerified,true);assert.equal(identity.user.passwordCredential,true);
 const provider=(await runtime.pool.query('SELECT id FROM newhope_auth."user"')).rows[0].id;assert.notEqual(provider,identity.user.id,'Canonical UUID is independent from provider ID');assert.equal((await pg.query<{n:number}>('SELECT count(*)::int AS n FROM internal.tenants')).rows[0].n,0);
 assert.equal((await call('/identity',undefined,{authorization:'Bearer forged'})).status,401,'Never downgrade a forged bearer to another cookie session');
 const enabled=await (await call('/two-factor/enable',{password:'Synthetic-Password-For-Tests-2026'})).json();assert(enabled.totpURI&&enabled.backupCodes?.length);const otp=createOTP(base32.decode(new URL(enabled.totpURI).searchParams.get('secret')!));
 assert.equal((await call('/two-factor/verify-totp',{code:await otp.totp(),trustDevice:false})).status,200);
 const stepUp=await (await call('/identity')).json();assert.equal(stepUp.session.aal,'aal2');assert(stepUp.session.mfaVerifiedAt>0);
 // Native handoff consumes one code only, with PKCE and a live session check.
 const sessionCookie=cookie.split('; ').find(v=>v.includes('session_token='))!.split('=').slice(1).join('='),code=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),hash=(v:string)=>createHash('sha256').update(v).digest('base64url'),tx=randomBytes(32).toString('base64url');
 await runtime.pool.query("INSERT INTO newhope_auth.native_transactions(id,challenge,expires_at,completed_at) VALUES($1,$2,now()+interval '5 minutes',now())",[tx,hash(verifier)]);
 await runtime.pool.query("INSERT INTO newhope_auth.native_handoffs(code_hash,transaction_id,token_encrypted,expires_at) VALUES($1,$2,$3,now()+interval '60 seconds')",[hash(code),tx,sealAuthState(sessionCookie,getAuthConfig().secret,'native-session:'+base,60)]);
 assert.equal((await call('/native/exchange',{code,verifier:'x'.repeat(43)},{origin:'capacitor://localhost'})).status,401);
 const exchanges=await Promise.all([call('/native/exchange',{code,verifier},{origin:'capacitor://localhost'}),call('/native/exchange',{code,verifier},{origin:'capacitor://localhost'})]);assert.deepEqual(exchanges.map(r=>r.status).sort(),[200,401]);assert(exchanges.find(r=>r.status===200)!.headers.get('set-auth-token'));
 await call('/sign-out',{});assert.equal((await call('/identity',undefined,{authorization:'Bearer '+signed})).status,401);
 const newLogin=await call('/sign-in/email',{email:'new-user@fixture.invalid',password:'Synthetic-Password-For-Tests-2026'});assert.equal((await newLogin.json()).twoFactorRedirect,true);assert(!newLogin.headers.get('set-auth-token'),'MFA-pending password response cannot mint a bearer');
 assert.equal((await call('/two-factor/verify-backup-code',{code:enabled.backupCodes[0],trustDevice:false})).status,200);const recovered=await (await call('/identity')).json();assert.equal(recovered.session.aal,'aal1');assert(!recovered.session.mfaVerifiedAt,'Recovery codes never become fresh TOTP step-up');
 assert.equal((await call('/two-factor/disable',{password:'Synthetic-Password-For-Tests-2026'})).status,403,'Recovery proof cannot disable MFA');
 await call('/request-password-reset',{email:'new-user@fixture.invalid',redirectTo:base+'/reset-password'});const reset=new URL(mail.at(-1)!.url),token=reset.pathname.split('/').at(-1)!;
 assert.equal((await call('/reset-password',{token,newPassword:'Synthetic-Changed-Password-For-Tests-2026'})).status,200);assert.equal((await call('/identity')).status,401,'Password recovery revokes all existing sessions');
 const sealed=sealAuthState('pending',getAuthConfig().secret,'purpose',1,0);assert.equal(openAuthState(sealed,getAuthConfig().secret,'purpose',500),'pending');assert.throws(()=>openAuthState(sealed,getAuthConfig().secret,'other',500));assert.throws(()=>openAuthState(sealed,getAuthConfig().secret,'purpose',1000));
 console.log('PASS actual Better Auth + isolated SQL: schema parity, verified password signup, canonical identity, no duplicate tenant, session-bound TOTP/recovery, revoke/reset, PKCE one-use native handoff and state sealing. Email captured; Google and hosted/mobile provider sessions remain separate acceptance.');
}finally{await new Promise<void>(r=>server.close(()=>r()));await runtime.close();await wire.stop();await pg.close();}
