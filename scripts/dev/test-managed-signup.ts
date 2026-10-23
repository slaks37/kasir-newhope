import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAuthClient} from '@neondatabase/auth';
import {SupabaseAuthAdapter,BetterAuthVanillaAdapter} from '@neondatabase/auth/vanilla/adapters';
import {signUpManagedEmail} from '../../src/lib/auth/managedSignup';
const base='https://ep-flat-recipe-azti3hh0.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth';
const owner=randomUUID(),now=new Date().toISOString(),user={id:owner,email:'synthetic@example.invalid',name:'Synthetic owner',emailVerified:false,createdAt:now,updatedAt:now};
const credentials={email:user.email,password:'synthetic-password-never-sent',options:{emailRedirectTo:'https://staging.example.invalid/login',data:{full_name:'Synthetic owner',store_name:'Synthetic store',emailVerified:true,role:'admin'}}};
const original=globalThis.fetch,calls:{path:string;body:any}[]=[];let rejected=false,malformed=false;
try{
 globalThis.fetch=async(input,options)=>{
  const url=String(input);assert(url.startsWith(base+'/'));assert.equal(options?.credentials,'include');const path=url.slice(base.length);calls.push({path,body:options?.body?JSON.parse(String(options.body)):null});
  if(path.startsWith('/sign-up/email'))return new Response(JSON.stringify(rejected?{code:'SIGN_UP_DISABLED',message:'Synthetic provider rejection'}:malformed?{}:{token:null,user}),{status:rejected?403:200,headers:{'content-type':'application/json'}});
  if(path.startsWith('/get-session'))return new Response('null',{headers:{'content-type':'application/json'}});
  throw Error('Unexpected mock request');
 };
 const legacy=createAuthClient(base,{adapter:SupabaseAuthAdapter({fetchOptions:{credentials:'include'}})});
 const before=await legacy.signUp(credentials);assert.equal(before.error?.message,'Failed to retrieve user session','Independently reproduce the installed adapter defect');assert.equal(calls.filter(c=>c.path.startsWith('/sign-up/email')).length,1);
 const managed=createAuthClient(base,{adapter:BetterAuthVanillaAdapter({fetchOptions:{credentials:'include'}})});
 let sessionReads=0;const noSession=async()=>{sessionReads++;return {data:{session:null},error:null};};
 const signup=(input:Parameters<typeof managed.signUp.email>[0])=>managed.signUp.email(input);
 let start=calls.length;const fixed=await signUpManagedEmail(signup,noSession,credentials);
 assert.deepEqual(fixed,{data:{user:null,session:null},error:null});assert.equal(sessionReads,0,'Unverified signup must not request an impossible session');
 assert.deepEqual(calls.slice(start).map(c=>c.path),['/sign-up/email'],'Exactly one signup; no retry or extra verification send');
 assert.deepEqual(calls.at(-1)?.body,{email:user.email,password:credentials.password,name:'Synthetic owner',callbackURL:credentials.options.emailRedirectTo},'Business/role/verification metadata must not override managed identity fields');
 rejected=true;const denial=await signUpManagedEmail(signup,noSession,credentials);assert(denial.error);assert.equal(denial.data.session,null);assert.equal(sessionReads,0);rejected=false;
 malformed=true;assert((await signUpManagedEmail(signup,noSession,credentials)).error);malformed=false;
 const wrongEmail=async()=>({data:{user:{...user,email:'foreign@example.invalid'}},error:null});assert((await signUpManagedEmail(wrongEmail,noSession,credentials)).error);
 const missingVerified=async()=>({data:{user:{id:owner,email:user.email} as any},error:null});assert((await signUpManagedEmail(missingVerified,noSession,credentials)).error);
 const unavailable=async()=>{throw Error('network timeout');};start=sessionReads;assert((await signUpManagedEmail(unavailable,noSession,credentials)).error);assert.equal(sessionReads,start);
 user.emailVerified=true;assert((await signUpManagedEmail(signup,noSession,credentials)).error,'Verified signup without a signed session must fail closed');
 const session:any={access_token:'synthetic-signed-jwt',user:{id:owner,email:user.email,email_confirmed_at:now}};
 assert.equal((await signUpManagedEmail(signup,async()=>({data:{session},error:null}),credentials)).data.session,session);
 assert((await signUpManagedEmail(signup,async()=>({data:{session:{...session,user:{...session.user,id:randomUUID()}}},error:null}),credentials)).error,'An existing different-user session cannot authorize the new account');
 assert((await signUpManagedEmail(signup,async()=>({data:{session:{...session,user:{...session.user,email_confirmed_at:undefined}}},error:null}),credentials)).error);
 console.log('PASS managed signup: original adapter failure reproduced; native unverified success awaits email with zero session/duplicate send, provider/malformed/network rejection, metadata isolation, verified signed-session and UUID/email consistency');
}finally{globalThis.fetch=original;}
