import assert from 'node:assert/strict';
import {build} from 'esbuild';
const nativeFetch=globalThis.fetch,storage=new Map<string,string>(),socialCalls:unknown[]=[];
const browser={location:{origin:'https://staging.example.invalid'},dispatchEvent:()=>true};
const storageApi={getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)};
Object.assign(globalThis,{window:browser,sessionStorage:storageApi,localStorage:storageApi});
try {
 for(const managed of [true,false]){
  let socialDenied=false,sessionPresent=true;
  (globalThis as any).__managedAdminFixture={getSession:async()=>({data:{session:sessionPresent?{access_token:'synthetic-signed-bearer'}:null}}),signOut:async()=>({error:null}),signInWithOAuth:async(options:unknown)=>{socialCalls.push(options);return {error:socialDenied?{message:'provider denied'}:null};}};
  const compiled=await build({entryPoints:['src/admin/api.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'isolated-auth-transport',setup(b){b.onResolve({filter:/lib\/supabase$/},()=>({path:'auth',namespace:'synthetic'}));b.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:`export const usesNeonAuth=${managed};export const isSupabaseConfigured=true;export const supabase={auth:globalThis.__managedAdminFixture};` }));}}]});
  const {api,getIdentity}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  assert.equal(getIdentity(),null);
  if(!managed){const count=socialCalls.length;await assert.rejects(api.loginWithGoogle(),(e:any)=>e.code==='AUTH_NOT_CONFIGURED');assert.equal(socialCalls.length,count,'Legacy modes must not acquire a new OAuth path');continue;}
  await api.loginWithGoogle();assert.deepEqual(socialCalls.at(-1),{provider:'google',options:{redirectTo:browser.location.origin+'/admin'}});
  assert.equal(getIdentity(),null,'Starting OAuth cannot fabricate an admin identity');
  socialDenied=true;await assert.rejects(api.loginWithGoogle(),(e:any)=>e.code==='GOOGLE_LOGIN_FAILED');
  let calls=0,status=403,result:any={ok:false,error:'INTERNAL_MEMBERSHIP_REQUIRED'};
  globalThis.fetch=async(input,options)=>{calls++;assert.equal(String(input),'/api/admin/me');const headers=options?.headers as Record<string,string>;assert.equal(headers.Authorization,'Bearer synthetic-signed-bearer');assert.equal(headers['x-newhope-admin-mfa'],undefined);return new Response(JSON.stringify(result),{status,headers:{'content-type':'application/json'}});};
  await assert.rejects(api.me(),(e:any)=>e.code==='INTERNAL_MEMBERSHIP_REQUIRED');assert.equal(calls,1,'A real managed session is checked even with no admin browser hint');
  status=200;result={ok:true,user:{email:'synthetic@example.invalid',role:'ROLE_SUPERADMIN'},capabilities:['VIEW_MERCHANT_HEALTH'],mfaRequired:true};
  assert.equal((await api.me()).mfaRequired,true,'Server MFA requirement must survive the client');
  sessionPresent=false;await assert.rejects(api.me(),(e:any)=>e.status===401);assert.equal(calls,2,'A missing managed session must not make an authenticated request');
 }
 console.log('PASS managed admin client: same-origin Google callback, provider denial, legacy mode refusal, server membership without browser hint, MFA preserved and missing session rejected; no real email or admin granted');
}finally{globalThis.fetch=nativeFetch;delete (globalThis as any).__managedAdminFixture;delete (globalThis as any).window;delete (globalThis as any).sessionStorage;delete (globalThis as any).localStorage;}
