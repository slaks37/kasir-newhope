import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createAuthClient} from '@neondatabase/auth';
import {BetterAuthVanillaAdapter} from '@neondatabase/auth/vanilla/adapters';
import {recoveryEmail,verificationCode,verificationFailure} from '../../src/lib/auth/managedRecovery';

assert.equal(recoveryEmail('  synthetic@example.invalid  '),'synthetic@example.invalid');
for(const value of ['', 'not-email', 'one@example.invalid two@example.invalid'])assert.equal(recoveryEmail(value),'');
assert.equal(verificationCode(' 123456 '),'123456');
for(const value of ['', 'mypassword', 'one@example.invalid', '123 456', '123456abc', '1'.repeat(33)])assert.equal(verificationCode(value),'');
assert.match(verificationFailure(new Error('OTP expired')),/kedaluwarsa/);
assert.match(verificationFailure({message:'Invalid OTP'}),/tidak cocok/);
assert(!verificationFailure(new Error('secret provider detail')).includes('secret'));

const base='https://ep-flat-recipe-azti3hh0.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth';
const native=globalThis.fetch,calls:{path:string;body:unknown}[]=[];
let reject=false;
try{
 globalThis.fetch=async(input,options)=>{
  const url=String(input);assert(url.startsWith(base+'/'));assert.equal(options?.method,'POST');assert.equal(options.credentials,'include');
  const path=url.slice(base.length);calls.push({path,body:JSON.parse(String(options.body))});
  assert(['/email-otp/send-verification-otp','/email-otp/verify-email'].includes(path));
  return new Response(JSON.stringify(reject?{code:'INVALID_OTP',message:'Invalid OTP'}:{success:true}),{status:reject?400:200,headers:{'content-type':'application/json'}});
 };
 const managed=createAuthClient(base,{adapter:BetterAuthVanillaAdapter({fetchOptions:{credentials:'include'}})});
 const email=recoveryEmail(' synthetic@example.invalid ');
 assert.equal((await managed.emailOtp.sendVerificationOtp({email,type:'email-verification'})).error,null);
 assert.deepEqual(calls.at(-1),{path:'/email-otp/send-verification-otp',body:{email,type:'email-verification'}});
 assert.equal((await managed.emailOtp.verifyEmail({email,otp:verificationCode(' 123456 ')})).error,null);
 assert.deepEqual(calls.at(-1),{path:'/email-otp/verify-email',body:{email,otp:'123456'}});
 reject=true;await assert.rejects(managed.emailOtp.verifyEmail({email,otp:'654321'}),(error:unknown)=>/tidak cocok/.test(verificationFailure(error)));
 assert.equal(calls.length,3,'One explicit send and two explicit verify calls; no SDK retry or resend');
}finally{globalThis.fetch=native;}

// Render the real component with only its provider/layout boundary mocked.
const folder='build/full-neon',file=folder+'/recovery-ssr-'+randomUUID()+'.mjs';await mkdir(folder,{recursive:true});
try{
 const compiled=await build({entryPoints:['src/components/auth/NeonAccountRecovery.tsx'],bundle:true,write:false,format:'esm',platform:'node',packages:'external',jsx:'automatic',plugins:[{name:'no-auth-side-effects',setup(b){
  b.onResolve({filter:/lib\/auth\/neonManaged$/},()=>({path:'auth',namespace:'mock'}));b.onResolve({filter:/^\.\/AuthLayout$/},()=>({path:'layout',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='auth'?'export const managedAuth=null;':'export const AuthLayout=({children})=>children;'}));
 }}]});await writeFile(file,compiled.outputFiles[0].text);
 const {NeonLoginHelp}=await import(pathToFileURL(process.cwd()+'/'+file).href);
 const populated=renderToStaticMarkup(createElement(NeonLoginHelp,{email:'synthetic@example.invalid',onEmailChange:()=>{}}));
 assert.match(populated,/value="synthetic@example.invalid"/);assert.match(populated,/<strong>synthetic@example.invalid<\/strong>/);
 assert.match(populated,/pattern="\[0-9\]\+"/);assert.match(populated,/<button disabled="">Verifikasi email/);
 const empty=renderToStaticMarkup(createElement(NeonLoginHelp,{email:'',onEmailChange:()=>{}}));
 assert.match(empty,/Isi email akun/);assert.match(empty,/<button disabled="" type="button">Kirim kode verifikasi/);
 console.log('PASS managed recovery: numeric-only normalization, error privacy, actual installed SDK method/path/type/cookies/no retry, controlled recipient and disabled invalid/empty form; no real email or verification sent');
}finally{await rm(file,{force:true});}
