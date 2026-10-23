import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {authReturnUrl} from '../../services/shared/authReturnUrl';

const html=fs.readFileSync('index.html','utf8');
const origin='https://kasir.newhope.space',admin='https://admin.newhope.space';
assert.equal(authReturnUrl('RESET',undefined,origin,[origin,admin]),origin+'/reset-password');
assert.equal(authReturnUrl('VERIFY',admin+'/login',origin,[origin,admin]),admin+'/login');
for(const value of [origin+'/blog',origin+'/?token=x',admin+'/reset-password#token',origin+'/reset-password?next=x',
  'https://foreign.invalid/reset-password',origin+'/reset-password/',origin+'/%72eset-password',42])
  assert.throws(()=>authReturnUrl('RESET',value,origin,[origin,admin]));
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(script);
assert(html.includes('<meta name="referrer" content="no-referrer" />'));
assert(!html.includes('googletagmanager.com/ns.html'));
for(const path of ['/login','/register','/reset-password','/verify-email','/api/auth/verify-email','/app?token=fixture','/auth/callback','/app?neon_auth_session_verifier=fixture','/?code=fixture','/app#access_token=fixture','/?neon_popup=fixture','/?neon_popup_callback=fixture']){
  const url=new URL(path,'https://fixture.invalid');
  const requested:string[]=[];
  const context={window:{location:url},URLSearchParams,Date,document:{
    createElement:()=>({}),getElementsByTagName:()=>[{parentNode:{insertBefore:(element:{src:string})=>requested.push(element.src)}}],
  }};
  vm.runInNewContext(script,context);
  assert.deepEqual(requested,[],'Auth links must not initialize third-party tracking before React removes tokens');
}
const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
for(const source of ['/reset-password','/api/auth/(.*)']){
  const headers=Object.fromEntries(config.headers.find((entry:{source:string})=>entry.source===source).headers.map((header:{key:string;value:string})=>[header.key,header.value]));
  assert.equal(headers['Referrer-Policy'],'no-referrer');
  assert.equal(headers['Cache-Control'],'private, no-store');
  assert.equal(headers['X-Robots-Tag'],'noindex, nofollow');
}
console.log('PASS: auth/reset links produce no tracking request and use no-referrer/no-store/noindex headers');
