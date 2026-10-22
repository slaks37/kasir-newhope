import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAuthClient} from '@neondatabase/auth';
import {SupabaseAuthAdapter,BetterAuthVanillaAdapter} from '@neondatabase/auth/vanilla/adapters';
const origin='https://ep-flat-recipe-azti3hh0.neonauth.c-3.ap-southeast-1.aws.neon.tech',base=origin+'/neondb/auth';
const owner=randomUUID(),now=new Date().toISOString(),jwt='signed.jwt.transport-fixture';
const user={id:owner,email:'synthetic@example.invalid',name:'Synthetic owner',emailVerified:true,createdAt:now,updatedAt:now};
const session={id:randomUUID(),userId:owner,token:'opaque-cookie-secret-not-a-bearer',expiresAt:new Date(Date.now()+3600000).toISOString(),createdAt:now,updatedAt:now};
const native=globalThis.fetch,calls:{url:string;credentials:RequestCredentials|undefined;body:any}[]=[];
let rejectSocial=false;
try{
 globalThis.fetch=async(input,options)=>{
  const url=String(input);assert(url.startsWith(base+'/'),'SDK must never call Supabase or a second auth server');
  calls.push({url,credentials:options?.credentials,body:options?.body?JSON.parse(String(options.body)):null});
  if(url.startsWith(base+'/get-session'))return new Response(JSON.stringify({user,session}),{headers:{'content-type':'application/json','set-auth-jwt':jwt}});
  if(url.startsWith(base+'/sign-out'))return new Response(JSON.stringify({success:true}),{headers:{'content-type':'application/json'}});
  if(url.startsWith(base+'/request-password-reset'))return new Response(JSON.stringify({status:true}),{headers:{'content-type':'application/json'}});
  if(url.startsWith(base+'/sign-in/social'))return new Response(JSON.stringify(rejectSocial?{code:'INVALID_ORIGIN',message:'Synthetic OAuth denial'}:{url:'https://accounts.google.com/o/oauth2/v2/auth',redirect:false}),{status:rejectSocial?403:200,headers:{'content-type':'application/json'}});
  throw Error('Unexpected SDK request');
 };
 const adapter=createAuthClient(base,{adapter:SupabaseAuthAdapter({fetchOptions:{credentials:'include'}})});
 const current=await adapter.getSession();assert.equal(current.error,null);assert.equal(current.data.session?.user.id,owner);
 assert.equal(current.data.session?.access_token,jwt,'Neon SDK must replace opaque session token with signed JWT header');
 assert(current.data.session?.user.email_confirmed_at);
 const managed=createAuthClient(base,{adapter:BetterAuthVanillaAdapter({fetchOptions:{credentials:'include'}})});
 const social=await adapter.signInWithOAuth({provider:'google',options:{redirectTo:'https://staging.example.invalid/login',skipBrowserRedirect:true}});assert.equal(social.error,null);
 const socialCall=calls.find(c=>c.url.endsWith('/sign-in/social'))!;assert.equal(socialCall.body.provider,'google');assert.equal(socialCall.body.callbackURL,'https://staging.example.invalid/login');assert.equal(socialCall.credentials,'include');
 rejectSocial=true;const rejected=await adapter.signInWithOAuth({provider:'google',options:{redirectTo:'https://staging.example.invalid/login',skipBrowserRedirect:true}});assert.equal(rejected.error?.status,403);assert.equal(rejected.error?.message,'Synthetic OAuth denial');rejectSocial=false;
 const reset=await managed.requestPasswordReset({email:user.email,redirectTo:'https://kasir.newhope.space/reset-password'});assert.equal(reset.error,null);
 assert.equal(calls.find(c=>c.url.endsWith('/request-password-reset'))?.body.redirectTo,'https://kasir.newhope.space/reset-password');
 const signout=await adapter.signOut();assert.equal(signout.error,null);assert(calls.every(c=>c.credentials==='include'));
 console.log('PASS actual Neon SDK contract with mocked network: managed endpoint, cookies, JWT, UUID, verified email, Google callback and provider failure, reset and logout; no real email sent');
}finally{globalThis.fetch=native;}
