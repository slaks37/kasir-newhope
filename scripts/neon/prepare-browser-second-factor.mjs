import fs from 'node:fs';
import {stagingTarget} from './better-target.mjs';
import {createOTP} from '@better-auth/utils/otp';
import {base32} from '@better-auth/utils/base32';

const {env}=stagingTarget(),origin=env.BETTER_AUTH_URL;
if(origin!=='http://127.0.0.1:5173')throw Error('REFUSE_NONLOCAL_BROWSER_FIXTURE');
const fixture=JSON.parse(fs.readFileSync('build/neon/browser-fixture.json','utf8'));
if(!/^browser-pilot-.+@example\.invalid$/.test(fixture.email))throw Error('REFUSE_NON_SYNTHETIC_ACCOUNT');
async function post(path,body,cookie='',token=''){
  const r=await fetch(origin+'/api/auth'+path,{method:'POST',headers:{origin,'content-type':'application/json',cookie,...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const data=await r.json();
  if(!r.ok)throw Error('BROWSER_FIXTURE_AUTH_FAILED:'+path+':'+r.status);
  return {data,cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),token:r.headers.get('set-auth-token')};
}
const login=await post('/sign-in/email',{email:fixture.email,password:fixture.password});
if(!login.token)throw Error('USE_FRESH_BROWSER_FIXTURE');
const enrollment=await post('/two-factor/enable',{password:fixture.password,method:'totp'},login.cookie,login.token);
const uri=new URL(enrollment.data.totpURI),secret=new TextDecoder().decode(base32.decode(uri.searchParams.get('secret')));
const activated=await post('/two-factor/verify-totp',{code:await createOTP(secret,{period:30,digits:6}).totp()},enrollment.cookie||login.cookie,login.token);
await post('/sign-out',{},activated.cookie,activated.token);
fs.writeFileSync('build/neon/browser-second-factor.json',JSON.stringify({email:fixture.email,secret,backupCode:enrollment.data.backupCodes[0]}),{mode:0o600});
console.log('Synthetic browser fixture MFA ready; credentials stored only in ignored private fixture');
