import assert from 'node:assert/strict';
import {randomUUID,createPrivateKey,sign} from 'node:crypto';
import {offlineIdentityKeys,issueOfflineIdentity} from '../../services/shared/offlineIdentity';
import {verifyOfflineIdentity,offlinePublicKey,createOfflineIdentityStore,OFFLINE_IDENTITY_KEY,OFFLINE_DEVICE_KEY} from '../../src/lib/auth/offlineIdentity';
import {authHeaders,authSessionKey} from '../../src/lib/authRuntime';
import {nativeAuthTarget} from '../../src/platform/runtime/nativeAuthTransport';
import {createNeonAuthClient} from '../../src/lib/auth/neonClient';
const secret='synthetic-only-offline-signing-secret-'.repeat(3),issuer='https://auth.fixture.invalid',canonical=randomUUID(),device=randomUUID(),sessionId=randomUUID(),time=Date.now();
const user={id:canonical,email:'staff@fixture.invalid',twoFactorEnabled:true,passwordCredential:false,providers:['google'],user_metadata:{full_name:'Synthetic staff'}};
const issue=(overrides:any={})=>issueOfflineIdentity({secret,issuer,device,sessionId,expiresAt:new Date(time+1800000),user,...overrides},time);
const key=offlineIdentityKeys(secret,issuer).publicKey,token=issue(),decode=(t:string)=>JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString());
assert.deepEqual(offlineIdentityKeys(secret,issuer).publicKey,key);assert.notDeepEqual(offlineIdentityKeys(secret,'https://other.fixture.invalid').publicKey,key);
assert(!JSON.stringify(key).includes('"d"'));assert.throws(()=>offlinePublicKey(JSON.stringify({...key,d:'private'})));
assert.equal((await verifyOfflineIdentity(token,key,issuer,device,time)).sub,canonical);
const p=decode(token);assert.equal(p.exp,p.sessionExp);assert.equal(p.exp-p.iat,1800);assert(!JSON.stringify(p).includes('mfaVerifiedAt'));assert(!JSON.stringify(p).includes('access_token'));
for(const [candidate,k,iss,dev,t]of [
 [token.slice(0,-2)+'zz',key,issuer,device,time], [token,offlineIdentityKeys(secret+'wrong',issuer).publicKey,issuer,device,time],
 [token,key,'https://other.fixture.invalid',device,time],[token,key,issuer,randomUUID(),time],[token,key,issuer,device,time+1800000],[token,key,issuer,device,time-60000],
] as const)await assert.rejects(()=>verifyOfflineIdentity(candidate,k,iss,dev,t));
// Signed but structurally invalid capabilities must fail too, not only tampered signatures.
const signClaims=(claims:any)=>{const head=token.split('.')[0],body=head+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url');return body+'.'+sign('sha256',Buffer.from(body),{key:offlineIdentityKeys(secret,issuer).privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');};
for(const change of [{aud:'api-access'},{exp:p.iat+3601,sessionExp:p.iat+7200},{sub:randomUUID()},{user:{...p.user,user_metadata:{role:'OWNER'}}}])await assert.rejects(()=>verifyOfflineIdentity(signClaims({...p,...change}),key,issuer,device,time));
let online=true,now=time;const data=new Map<string,string>([[OFFLINE_DEVICE_KEY,device],['financial-outbox','immutable']]);const storage={getItem:async(k:string)=>data.get(k)||null,setItem:async(k:string,v:string)=>{data.set(k,v);},removeItem:async(k:string)=>{data.delete(k);}};
const receipt=createOfflineIdentityStore({key:JSON.stringify(key),issuer,storage,online:()=>online,now:()=>now});await receipt.save(token,canonical,sessionId);assert.equal(await receipt.read(),null);online=false;assert.equal((await receipt.read())?.sub,canonical);await assert.rejects(()=>receipt.save(token,randomUUID(),sessionId));
let calls=0,state='ready',resolveLate:((v:Response)=>void)|undefined;
const identity=()=>({user:{...user,emailVerified:true},session:{id:sessionId,expiresAt:new Date(time+1800000).toISOString(),aal:'aal2',mfaVerifiedAt:time/1000},offlineReceipt:token});
const fetcher:typeof fetch=async(_url,init)=>{calls++;assert.equal(new Headers(init?.headers).get('authorization'),null);if(String(_url).endsWith('/sign-out'))return new Response('{}');assert.equal(new Headers(init?.headers).get('x-newhope-offline-device'),device);if(state==='late')return new Promise(r=>{resolveLate=r;});if(state==='revoked')return new Response('{"error":"AUTH_SESSION_REQUIRED"}',{status:401});if(state==='mapping')return new Response('{"error":"IDENTITY_MAPPING_REQUIRED"}',{status:403});if(state==='outage')return new Response('{}',{status:503});return new Response(JSON.stringify(identity()));};
const client=()=>createNeonAuthClient({baseURL:issuer+'/api/auth',appOrigin:issuer,fetch:fetcher,now:()=>now,offline:{publicKey:JSON.stringify(key),storage,online:()=>online}});
online=true;let auth=client();assert.equal((await auth.getSession()).data.session?.aal,'aal2');const before=calls;online=false;auth=client();const recovered=await auth.getSession();assert.equal(calls,before,'Cold offline restoration never contacts a provider');assert.equal(recovered.data.session?.user.id,canonical);assert.equal(recovered.data.session?.offlineRecovery,true);assert.equal(recovered.data.session?.aal,'aal1');assert.equal(recovered.data.session?.mfaVerifiedAt,undefined);assert.equal(recovered.data.session?.access_token,'');
now=time+1800000;assert.equal((await auth.getSession()).error?.code,'OFFLINE_IDENTITY_UNAVAILABLE');now=time;online=true;state='outage';assert.equal((await auth.getSession()).error?.code,'AUTH_UNAVAILABLE','Online outage never downgrades to cached identity');
for(const rejected of ['revoked','mapping']){online=true;state='ready';await auth.getSession();assert(data.has(OFFLINE_IDENTITY_KEY));state=rejected;await auth.getSession();assert(!data.has(OFFLINE_IDENTITY_KEY));online=false;assert.equal((await client().getSession()).data.session,null);}
online=true;state='ready';auth=client();await auth.getSession();state='late';const pending=auth.getSession();await Promise.resolve();await new Promise(r=>setTimeout(r,0));assert(resolveLate);await auth.signOut();resolveLate(new Response(JSON.stringify(identity())));await pending;assert(!data.has(OFFLINE_IDENTITY_KEY),'Late identity cannot resurrect receipt after logout');online=false;assert.equal((await client().getSession()).data.session,null);
assert.equal(data.get('financial-outbox'),'immutable');console.log('PASS offline identity: actual P-256/WebCrypto signatures, pinned key/device/issuer/session/expiry, cold restore without bearer/MFA promotion, online denial/outage, late logout race and immutable queues. HTTP client responses simulated.');

assert.equal(nativeAuthTarget(issuer+'/api/auth/identity',issuer+'/api/auth','https://native-api.fixture.invalid'),'https://native-api.fixture.invalid/api/auth/identity');
for(const bad of ['https://evil.fixture.invalid/api/auth/identity',issuer+'/api/else',issuer+'/api/auth/identity#token',issuer.replace('https://','https://user:password@')+'/api/auth/identity'])assert.throws(()=>nativeAuthTarget(bad,issuer+'/api/auth','https://native-api.fixture.invalid'));
assert.throws(()=>nativeAuthTarget(issuer+'/api/auth/identity',issuer+'/api/auth','http://untrusted.invalid'));

const normal={user:{...user,app_metadata:{}},access_token:'a-stale-native-token',sessionId,aal:'aal1' as const};
assert.deepEqual(authHeaders({...normal,offlineRecovery:true}),{});assert.notEqual(authSessionKey(normal),authSessionKey({...normal,offlineRecovery:true}));
