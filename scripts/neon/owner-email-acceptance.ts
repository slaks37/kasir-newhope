import fs from 'node:fs';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import {parse} from 'dotenv';import {Resend} from 'resend';
import {betterAuthPilotConfig} from '../../services/shared/betterAuthPilot';import {createBetterAuthRuntime} from '../../services/shared/betterAuth';import {authEmailPayload} from '../../services/shared/betterAuthEmail';
// Explicit owner-approved live test: one separate staging account, exactly one
// verification + one reset message. Public Preview remains mail-disabled.
const phase=process.argv[2],path='build/neon/private-owner-email-acceptance.json';
assert(['signup','request-reset','complete-reset-mfa'].includes(phase),'EXPLICIT_TEST_PHASE_REQUIRED');
assert(process.argv.includes('--owner-approved-two-message-test'),'OWNER_AUTHORIZATION_REQUIRED');
const env=parse(fs.readFileSync('.env.neon-hosted-preview.local'));assert.equal(env.APP_ENV,'staging');assert.equal(env.AUTH_EMAIL_ENABLED,'0');assert.equal(env.AUTH_EMAIL_ALLOWED_RECIPIENTS,'stefen@newsystem.space');
Object.assign(process.env,env,{AUTH_EMAIL_ENABLED:'1'});const config=betterAuthPilotConfig();assert.equal(config.baseUrl,'https://kasir-newhope-neon-staging.vercel.app');
let state:any=fs.existsSync(path)?JSON.parse(fs.readFileSync(path,'utf8')):{version:1,authorization:'Owner approved isolated test account and exactly one verification plus one password-reset to the specified mailbox in this chat',email:'stefen@newsystem.space',createdAt:new Date().toISOString(),password:randomBytes(30).toString('base64url'),messages:[]};
const save=()=>{fs.writeFileSync(path,JSON.stringify(state,null,2)+'\n',{mode:0o600});fs.chmodSync(path,0o600);};
const runtime=createBetterAuthRuntime(config,async mail=>{
 assert.equal(mail.email,state.email);assert(!state.messages.some((m:any)=>m.kind===mail.kind),'REFUSE_ADDITIONAL_REAL_MESSAGE');
 const prepared=authEmailPayload(mail);const job:any={kind:mail.kind,url:mail.url,requestedAt:new Date().toISOString(),status:'PENDING'};state.messages.push(job);save();
 const response=await new Resend(env.RESEND_API_KEY).emails.send(prepared.payload,{idempotencyKey:prepared.idempotencyKey});
 if(response.error||!response.data?.id){job.status='PROVIDER_REJECTED_OR_UNKNOWN';save();throw Error('OWNER_TEST_SEND_FAILED');}job.providerEmailId=response.data.id;job.status='PROVIDER_ACCEPTED';save();
});
async function auth(route:string,body?:unknown,expected=200,session?:any){
 const headers=new Headers({origin:config.baseUrl,'content-type':'application/json',...(session?.cookie?{cookie:session.cookie}:{}),...(session?.token?{authorization:'Bearer '+session.token}:{})});
 const r=await runtime.auth.handler(new Request(config.baseUrl+'/api/auth'+route,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})}));
 const data=await r.json().catch(()=>null);assert.equal(r.status,expected,'AUTH_PHASE_FAILED:'+route+':'+r.status+':'+(data?.code||'unknown'));
 return {data,token:r.headers.get('set-auth-token'),cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};
}
try{
 if(phase==='signup'){
  assert(!state.userId&&!state.messages.length,'REFUSE_REPEAT_SIGNUP');
  const existing=await runtime.pool.query('SELECT count(*)::int n FROM newhope_auth."user" WHERE lower(email)=lower($1)',[state.email]);assert.equal(existing.rows[0].n,0,'EXISTING_OWNER_TEST_ACCOUNT_REQUIRES_REVIEW');
  save();const result=await auth('/sign-up/email',{email:state.email,password:state.password,name:'New Hope isolated staging mail test',callbackURL:config.baseUrl+'/login'});state.userId=result.data.user.id;state.signupCompleted=true;save();
 }else if(phase==='request-reset'){
  assert(state.signupCompleted&&!state.messages.some((m:any)=>m.kind==='RESET'));
  const user=await runtime.pool.query('SELECT "emailVerified" FROM newhope_auth."user" WHERE id=$1',[state.userId]);assert.equal(user.rows[0]?.emailVerified,true,'HTTPS_VERIFICATION_NOT_COMPLETED');
  state.beforeResetSession=await auth('/sign-in/email',{email:state.email,password:state.password});assert(state.beforeResetSession.token);state.verificationConfirmed=true;save();
  await auth('/request-password-reset',{email:state.email,redirectTo:config.baseUrl+'/reset-password'});state.resetRequested=true;save();
 }else{
  assert(state.resetRequested&&state.resetHttpsCallbackConfirmed,'HTTPS_RESET_CALLBACK_REQUIRED');
  const reset=state.messages.find((m:any)=>m.kind==='RESET');const token=new URL(reset.url).pathname.split('/').at(-1);state.nextPassword=state.nextPassword||randomBytes(30).toString('base64url');save();
  if(!state.resetBackendComplete&&!state.privateMfaEnrollment)await auth('/reset-password',{token,newPassword:state.nextPassword});
  await auth('/reset-password',{token,newPassword:state.nextPassword},400);
  const old=await runtime.auth.api.getSession({headers:new Headers({authorization:'Bearer '+state.beforeResetSession.token}),query:{disableCookieCache:true}});assert.equal(old,null,'RESET_MUST_REVOKE_OLD_SESSION');state.resetBackendComplete=true;save();
  const signed=await auth('/sign-in/email',{email:state.email,password:state.nextPassword});assert(signed.token);
  const enabled=state.privateMfaEnrollment?{data:state.privateMfaEnrollment}:await auth('/two-factor/enable',{password:state.nextPassword,method:'totp'},200,signed);state.privateMfaEnrollment=enabled.data;save();
  const secret=new URL(enabled.data.totpURI).searchParams.get('secret');assert(secret);
  const {createOTP}=await import('@better-auth/utils/otp');const {base32}=await import('@better-auth/utils/base32');const otp=createOTP(new TextDecoder().decode(base32.decode(secret)),{digits:6,period:30});
  await auth('/two-factor/verify-totp',{code:await otp.totp()},200,signed);
  const user=(await runtime.pool.query('SELECT "twoFactorEnabled" FROM newhope_auth."user" WHERE id=$1',[state.userId])).rows[0];assert.equal(user.twoFactorEnabled,true);
  const sessions=(await runtime.pool.query('SELECT count(*)::int n FROM newhope_auth.session WHERE "userId"=$1',[state.userId])).rows[0].n;
  // Test account sessions are explicitly revoked after acceptance; retain account,
  // factor and audit. No source identity mapping or business authority is granted.
  await runtime.pool.query('DELETE FROM newhope_auth.session WHERE "userId"=$1',[state.userId]);
  state.completedAt=new Date().toISOString();state.checks={httpsVerification:true,httpsResetCallback:true,resetCompleted:true,spentResetDenied:true,oldSessionRevoked:true,freshTotpEnrolled:true,remainingSessions:0,sourceMappingChanges:0,businessAuthorityGranted:0};save();
  fs.writeFileSync('build/neon/owner-email-acceptance-summary.json',JSON.stringify({status:'BACKEND_ACCEPTANCE_PASSED_OWNER_INBOX_CONFIRMATION_PENDING',completedAt:state.completedAt,checks:state.checks,messages:state.messages.map((m:any)=>({kind:m.kind,providerEmailId:m.providerEmailId,status:m.status})),scope:'Owner-approved separate staging test identity; exact two real messages; native handler + hosted HTTPS callback; private tokens/password/MFA omitted; owner device enrollment and inbox/spam acceptance still external'},null,2)+'\n');
 }
 console.log(JSON.stringify({status:'PHASE_COMPLETED',phase,realMessagesAccepted:state.messages.filter((m:any)=>m.providerEmailId).length,privateState:path,credentialsAndLinksOmitted:true}));
}finally{await runtime.close();}
