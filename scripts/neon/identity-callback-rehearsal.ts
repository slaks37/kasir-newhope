import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'dotenv';
import {randomBytes,randomUUID} from 'node:crypto';
import express from 'express';

const roles=parse(fs.readFileSync('.env.neon-runtime-roles.local'));
const manifest=JSON.parse(fs.readFileSync('neon/targets/full-restore.json','utf8'));
assert.equal(roles.NEON_PROJECT_ID,manifest.projectId);assert.equal(roles.NEON_BRANCH_ID,manifest.branchId);assert.equal(manifest.default,false);
const canonical='https://kasir.newhope.space',admin='https://admin.newhope.space';
Object.assign(process.env,roles,{AUTH_PROVIDER:'better-auth',BETTER_AUTH_MIGRATION_PILOT:'1',NODE_ENV:'test',APP_ENV:'staging',VERCEL_ENV:'preview',
  BETTER_AUTH_URL:canonical,BETTER_AUTH_TRUSTED_ORIGINS:admin,BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),AUTH_EMAIL_ENABLED:'0'});
const {createBetterAuthRuntime}=await import('../../services/shared/betterAuth');
const {createBetterAuthHandler}=await import('../../src/server/betterAuthHandler');
const {authEmailPayload}=await import('../../services/shared/betterAuthEmail');
const mails:any[]=[],runtime=createBetterAuthRuntime(undefined,async mail=>{mails.push(mail);});
const evidence:any={startedAt:new Date().toISOString(),projectId:manifest.projectId,branchId:manifest.branchId,status:'RUNNING',scope:'Actual native HTTP with dedicated auth LOGIN, IPv6 loopback, synthetic invalid-domain account and injected mail sink; no production, customer credential or email delivery changes',checks:{}};
const app=express();app.use(createBetterAuthHandler(()=>runtime));const server=app.listen(0,'::1');
await new Promise<void>(resolve=>server.once('listening',()=>resolve()));
const address=server.address();assert(address&&typeof address!=='string');const base='http://[::1]:'+address.port;
async function request(path:string,body?:unknown,origin=admin,bearer='') {
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(20000)});
  return {status:response.status,data:await response.json().catch(()=>null),headers:response.headers};
}
const path=(mail:any)=>{const u=new URL(mail.url);assert.equal(u.origin,canonical);return u.pathname+u.search;};
try {
  assert.equal((await runtime.pool.query('SELECT current_user AS role')).rows[0].role,'newhope_auth_runtime_login');
  assert.equal((await request('/api/auth/get-session',undefined,admin)).status,200);
  assert.equal((await request('/api/auth/get-session',undefined,canonical)).status,200);
  assert.equal((await request('/api/auth/get-session',undefined,'https://foreign.invalid')).status,403);
  const email='callback-'+randomUUID()+'@example.invalid',password=randomBytes(24).toString('base64url');
  assert.equal((await request('/api/auth/sign-up/email',{email,password,name:'Synthetic callback fixture',callbackURL:admin+'/blog'})).status,400);
  assert.equal(mails.length,0,'Bad marketing callback rejected before mail hook');
  assert.equal((await request('/api/auth/sign-up/email',{email,password,name:'Synthetic callback fixture',callbackURL:admin+'/login'})).status,200);
  assert.equal(mails.length,1);const verify=mails[0];assert.equal(verify.kind,'VERIFY');
  assert.equal(new URL(verify.url).searchParams.get('callbackURL'),admin+'/login');
  const payloadEnv={AUTH_EMAIL_ENABLED:'1',AUTH_EMAIL_FROM:'New Hope POS <auth@kasir.newhope.space>',AUTH_EMAIL_VERIFIED_DOMAIN:'kasir.newhope.space',AUTH_EMAIL_ALLOWED_RECIPIENTS:email,RESEND_API_KEY:'fixture-no-send',VERCEL_ENV:'preview',BETTER_AUTH_TRUSTED_ORIGINS:admin};
  assert.equal(authEmailPayload(verify,payloadEnv).payload.to,email,'Native generated encoded verify query accepted by defensive mail renderer');
  const malformed=new URL(verify.url);malformed.searchParams.set('callbackURL',admin+'/blog');
  assert.equal((await request(malformed.pathname+malformed.search)).status,400);
  assert.equal((await request(path(verify)+'&callbackURL='+encodeURIComponent(admin+'/login'))).status,400,'Duplicate callback is rejected');
  const verified=await request(path(verify));assert.equal(verified.status,302);assert.equal(verified.headers.get('location'),admin+'/login');
  const signed=await request('/api/auth/sign-in/email',{email,password});assert.equal(signed.status,200);assert(signed.headers.get('set-auth-token'));
  const before=mails.length;
  assert.equal((await request('/api/auth/request-password-reset',{email,redirectTo:admin+'/blog'})).status,400);
  assert.equal(mails.length,before,'Bad reset callback rejected before mail hook');
  assert.equal((await request('/api/auth/request-password-reset',{email,redirectTo:admin+'/reset-password'})).status,200);
  const reset=mails.at(-1);assert(reset&&reset.kind==='RESET');assert.equal(new URL(reset.url).searchParams.get('callbackURL'),admin+'/reset-password');
  assert.equal(authEmailPayload(reset,payloadEnv).payload.to,email,'Native generated encoded reset query accepted by defensive mail renderer');
  const resetBad=new URL(reset.url);resetBad.searchParams.set('callbackURL',canonical+'/blog');
  assert.equal((await request(resetBad.pathname+resetBad.search)).status,400);
  const callback=await request(path(reset));assert.equal(callback.status,302);
  const redirect=new URL(callback.headers.get('location')!);assert.equal(redirect.origin,admin);assert.equal(redirect.pathname,'/reset-password');assert(redirect.searchParams.get('token'));
  const token=redirect.searchParams.get('token')!,newPassword=randomBytes(24).toString('base64url');
  assert.equal((await request('/api/auth/reset-password',{token,newPassword})).status,200);
  assert.equal((await request('/api/auth/reset-password',{token,newPassword})).status,400);
  const ended=await request('/api/auth/get-session',undefined,admin,signed.headers.get('set-auth-token')!);assert.equal(ended.status,200);assert.equal(ended.data,null);
  evidence.checks={dedicatedAuthRole:true,canonicalAndAdminOriginsAccepted:true,foreignOriginDenied:true,marketingCallbackDeniedBeforeMailer:true,nativeEncodedVerifyLinkCompatible:true,nativeEncodedResetLinkCompatible:true,duplicateCallbackDenied:true,approvedAdminAuthRedirects:true,resetSingleUse:true,oldNativeBearerRevokedByReset:true,messagesDelivered:0};
  evidence.status='PASS';console.log('PASS: exact POS/admin origins, native encoded auth links, bad/duplicate callback rejection before mailer, reset single use and old-session denial; no email delivered');
}catch(error){evidence.status='FAIL';evidence.failure=(error as Error).message;throw error;}
finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await runtime.close();evidence.finishedAt=new Date().toISOString();fs.writeFileSync('build/neon/identity-callback-rehearsal.json',JSON.stringify(evidence,null,2)+'\n');}
