import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createNeonAuthClient,NATIVE_BEARER_KEY,NATIVE_PKCE_KEY} from '../../src/lib/auth/neonClient';
const baseURL='https://staging.invalid/api/auth',canonical=randomUUID(),providerId='provider-user-with-a-different-id',now=Date.now();
const identity=()=>({user:{id:canonical,email:'synthetic@fixture.invalid',emailVerified:true,twoFactorEnabled:true,passwordCredential:true,providers:['credential','google'],user_metadata:{full_name:'Synthetic cashier'}},session:{id:'non-secret-session-row',expiresAt:new Date(now+3600000).toISOString(),aal:'aal2',mfaVerifiedAt:Math.floor(now/1000)}});
const reply=(body:any,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
for(const candidate of ['http://other.invalid/api/auth','https://evil.invalid/api/auth','https://u:p@staging.invalid/api/auth','https://staging.invalid/api/else','https://staging.invalid/api/auth?next=evil'])assert.throws(()=>createNeonAuthClient({baseURL:candidate,appOrigin:'https://staging.invalid',fetch:globalThis.fetch}));
// Provider verification denial must remain a denial and explain the next action.
let deniedRequests=0;
const unverified=createNeonAuthClient({baseURL,appOrigin:'https://staging.invalid',fetch:async()=>{deniedRequests++;return reply({code:'EMAIL_NOT_VERIFIED',message:'provider message must not replace safe local text'},403);}});
const verificationDenied=await unverified.signInWithPassword({email:'synthetic@fixture.invalid',password:'synthetic-password'});
assert.equal(verificationDenied.error?.code,'EMAIL_NOT_VERIFIED');
assert.match(verificationDenied.error?.message||'',/Email akun belum diverifikasi/);
assert.equal(verificationDenied.data.session,null);
assert.equal(deniedRequests,1,'No identity call or fallback after verification denial');
const calls:Array<{url:string;init:RequestInit}>=[];let state='ready',postedBody:any;
const fetcher:typeof fetch=async(input,init={})=>{const url=String(input);calls.push({url,init});assert(url.startsWith(baseURL+'/'));assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.credentials,'include');assert.equal(new Headers(init.headers).get('authorization'),null,'Browser credentials remain HttpOnly; no bearer is copied from a JSON payload/header');
 if(url.endsWith('/sign-in/email')){postedBody=JSON.parse(String(init.body));return state==='mfa'?reply({twoFactorRedirect:true}):reply({user:{id:providerId},token:'must-never-be-stored'},200,{'set-auth-token':'ignored-web-bearer'});}
 if(url.endsWith('/identity')){if(state==='outage')return reply({code:'INTERNAL_DB_ERROR'},503);if(state==='revoked')return reply({code:'UNAUTHORIZED'},401);if(state==='unmapped')return reply({error:'IDENTITY_MAPPING_REQUIRED'},403);if(state==='google-mfa')return reply({error:'MFA_REQUIRED',twoFactorRequired:true},401);if(state==='expired'){const value=identity();value.session.expiresAt=new Date(now-1).toISOString();return reply(value);}return reply(identity());}
 if(url.endsWith('/sign-out'))return state==='outage'?reply({},503):reply({success:true});
 if(url.endsWith('/two-factor/verify-totp')||url.endsWith('/two-factor/verify-backup-code')){postedBody=JSON.parse(String(init.body));state='ready';return reply({token:'ignored-web-token',user:{id:providerId}});}
 if(url.endsWith('/reset-password')){postedBody=JSON.parse(String(init.body));return reply({status:true});}
 throw Error('Unexpected auth URL '+url);
};
const browser=createNeonAuthClient({baseURL,appOrigin:'https://staging.invalid',fetch:fetcher,now:()=>now});
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Must use the captured auth transport, not the installed authenticated-fetch wrapper');};
try{
 const signed=await browser.signInWithPassword({email:'synthetic@fixture.invalid',password:'synthetic-password'});assert.equal(signed.error,null);assert.equal(signed.data.session?.user.id,canonical);assert.notEqual(signed.data.user?.id,providerId);assert.equal(signed.data.session?.access_token,'');assert.equal(signed.data.session?.sessionId,'non-secret-session-row');assert.equal(signed.data.user?.passwordCredential,true);assert.equal(postedBody.password,'synthetic-password');
 const events:string[]=[];browser.onAuthStateChange(event=>events.push(event));state='outage';assert.equal((await browser.getSession()).error?.code,'AUTH_UNAVAILABLE');assert.equal((await browser.signOut()).error?.code,'AUTH_UNAVAILABLE');assert(!events.includes('SIGNED_OUT'),'Outage cannot falsely confirm logout');
 state='unmapped';assert.equal((await browser.getSession()).error?.code,'IDENTITY_MAPPING_REQUIRED');state='expired';assert.equal((await browser.getSession()).error?.code,'INVALID_AUTH_RESPONSE');
 state='mfa';const firstFactor=await browser.signInWithPassword({email:'synthetic@fixture.invalid',password:'synthetic-password'});assert.equal(firstFactor.error?.code,'MFA_REQUIRED');assert.equal(firstFactor.data.session,null);
 await browser.mfa.challengeAndVerify({factorId:'neon-totp',code:'123456'});assert.equal(postedBody.trustDevice,false);assert.equal((await browser.getSession()).data.session?.user.id,canonical);
 state='google-mfa';assert.equal((await browser.getSession()).error?.code,'MFA_REQUIRED');assert(events.includes('MFA_REQUIRED'));state='ready';assert.equal((await browser.mfa.challengeAndVerify({factorId:'neon-totp',code:'single-use-backup',recovery:true})).error,null);assert(calls.some(c=>c.url.endsWith('/two-factor/verify-backup-code')));
 state='revoked';assert.equal((await browser.getSession()).data.session,null);assert(events.includes('SIGNED_OUT'));state='ready';assert.equal((await browser.signOut()).error,null);
 Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{href:'https://staging.invalid/reset-password?token=one-use-synthetic-token'}}});assert.equal((await browser.updateUser({password:'new-synthetic-password'})).error,null);assert.equal(postedBody.token,'one-use-synthetic-token');assert.equal(postedBody.newPassword,'new-synthetic-password');
}finally{globalThis.fetch=originalFetch;}
// Native bridge state and bearer survive app restart only in the secure vault.
const vault=new Map<string,string>(),touched:string[]=[];const storage={getItem:async(key:string)=>vault.get(key)||null,setItem:async(key:string,value:string)=>{touched.push(key);vault.set(key,value);},removeItem:async(key:string)=>{touched.push(key);vault.delete(key);}};
let nativeState='password';const nativeCalls:Array<{url:string;headers:Headers}>=[];
const nativeFetcher:typeof fetch=async(input,init={})=>{const url=String(input),headers=new Headers(init.headers);nativeCalls.push({url,headers});assert(url.startsWith(baseURL+'/'));assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
 if(url.endsWith('/sign-in/email'))return reply({twoFactorRedirect:true},200,{'x-newhope-auth-state':'opaque-encrypted-pending-state'});
 if(url.endsWith('/two-factor/verify-totp')){assert.equal(headers.get('x-newhope-auth-state'),'opaque-encrypted-pending-state');nativeState='identity';return reply({user:{id:providerId}},200,{'set-auth-token':'signed-native-session-token'});}
 if(url.endsWith('/native/exchange')){const body=JSON.parse(String(init.body));assert.equal(body.verifier,'synthetic-pkce-verifier');assert.equal(body.code,'one-use-code');nativeState='identity';return reply({ok:true},200,{'set-auth-token':'signed-native-session-token'});}
 if(url.endsWith('/identity')){if(nativeState==='revoked')return reply({error:'UNAUTHENTICATED'},401);if(nativeState==='google-mfa')return reply({error:'MFA_REQUIRED'},401);assert.equal(headers.get('authorization'),'Bearer signed-native-session-token');return reply(identity());}
 if(url.endsWith('/sign-out'))return reply({success:true});
 if(url.endsWith('/revoke-sessions')||url.endsWith('/revoke-other-sessions'))return nativeState==='management-denied'?reply({code:'REAUTH_REQUIRED'},403):reply({status:true});
 throw Error('Unexpected native path');};
let native=createNeonAuthClient({baseURL,appOrigin:'capacitor://localhost',native:true,fetch:nativeFetcher,storage,now:()=>now});
assert.equal((await native.signInWithPassword({email:'synthetic@fixture.invalid',password:'synthetic-password'})).error?.code,'MFA_REQUIRED');assert.equal(vault.get(NATIVE_BEARER_KEY),undefined);
assert.equal((await native.mfa.challengeAndVerify({factorId:'neon-totp',code:'123456'})).error,null);assert.equal(vault.get(NATIVE_BEARER_KEY),'signed-native-session-token');assert(![...vault.keys()].some(k=>k.includes('pending')));
native=createNeonAuthClient({baseURL,appOrigin:'capacitor://localhost',native:true,fetch:nativeFetcher,storage,now:()=>now});assert.equal((await native.getSession()).data.session?.user.id,canonical);
nativeState='google-mfa';assert.equal((await native.getSession()).error?.code,'MFA_REQUIRED');assert(vault.has(NATIVE_BEARER_KEY),'First-factor native bearer is retained only to complete MFA');
nativeState='identity';await storage.setItem(NATIVE_PKCE_KEY,'synthetic-pkce-verifier');assert.equal((await native.exchangeCodeForSession('one-use-code')).error,null);assert(!vault.has(NATIVE_PKCE_KEY));
nativeState='revoked';assert.equal((await native.getSession()).data.session,null);assert(!vault.has(NATIVE_BEARER_KEY));assert(touched.every(k=>k.startsWith('newhope-neon-auth-')||k===NATIVE_PKCE_KEY),'Authentication never clears financial queues');
// Logout scope is explicit; rejection never pretends other sessions were revoked.
vault.set('financial-outbox-sentinel','immutable-payload');nativeState='identity';await storage.setItem(NATIVE_BEARER_KEY,'signed-native-session-token');await native.getSession();
const scopeEvents:string[]=[];native.onAuthStateChange(e=>scopeEvents.push(e));
assert.equal((await native.signOut({scope:'others'})).error,null);assert(nativeCalls.at(-1)!.url.endsWith('/revoke-other-sessions'));assert(vault.has(NATIVE_BEARER_KEY));assert(!scopeEvents.includes('SIGNED_OUT'));
nativeState='management-denied';assert.equal((await native.signOut({scope:'global'})).error?.code,'REAUTH_REQUIRED');assert(nativeCalls.at(-1)!.url.endsWith('/revoke-sessions'));assert(vault.has(NATIVE_BEARER_KEY));assert(!scopeEvents.includes('SIGNED_OUT'));
nativeState='identity';assert.equal((await native.signOut({scope:'global'})).error,null);assert(!vault.has(NATIVE_BEARER_KEY));assert(scopeEvents.includes('SIGNED_OUT'));assert.equal(vault.get('financial-outbox-sentinel'),'immutable-payload');
assert(!readFileSync('src/lib/auth/neonClient.ts','utf8').includes('@supabase/'));
console.log('PASS Neon client: canonical actor IDs, cookie-only web sessions, isolated native vault/pending MFA relay, Google/password MFA, recovery codes, one-use PKCE exchange, live revocation/outage, no Supabase SDK/fallback and no financial queue deletion. HTTP responses simulated.');
