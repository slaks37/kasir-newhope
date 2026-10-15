import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parse} from 'dotenv';
import {authEmailPayload} from '../../services/shared/betterAuthEmail';
// Offline rendering only. Never call the provider or auth routes, create a user,
// issue a token, or persist an enabled environment. URLs cannot complete auth.
const file='.env.neon-hosted-preview.local';
assert.equal(fs.statSync(file).mode&0o077,0);
const configured=parse(fs.readFileSync(file));
assert.equal(configured.AUTH_EMAIL_ENABLED,'0','Keep real sending disabled pending owner approval');
assert.equal(configured.AUTH_EMAIL_ALLOWED_RECIPIENTS,'stefen@newsystem.space');
const origin='https://kasir-newhope-neon-staging.vercel.app';
const env={...configured,AUTH_EMAIL_ENABLED:'1'};
const prepared=['VERIFY','RESET'].map(kind=>{
 const callback=origin+(kind==='VERIFY'?'/login':'/reset-password');
 const url=origin+(kind==='VERIFY'?'/api/auth/verify-email?token=SAMPLE-NOT-ACTIVE&':'/api/auth/reset-password/SAMPLE-NOT-ACTIVE?')+'callbackURL='+encodeURIComponent(callback);
 const {payload}=authEmailPayload({kind:kind as 'VERIFY'|'RESET',email:'stefen@newsystem.space',url,baseUrl:origin},env);
 assert.equal(payload.from,'New Hope POS <auth@kasir.newhope.space>');
 return {kind,classification:'UNSENT TEMPLATE - NO VALID TOKEN',payload};
});
assert.throws(()=>authEmailPayload({kind:'RESET',email:'unauthorized@example.invalid',baseUrl:origin,url:origin+'/api/auth/reset-password/SAMPLE-NOT-ACTIVE?callbackURL='+encodeURIComponent(origin+'/reset-password')},env));
fs.mkdirSync('build/neon',{recursive:true,mode:0o700});
fs.writeFileSync('build/neon/prepared-owner-emails.json',JSON.stringify({preparedAt:new Date().toISOString(),authorization:'NOT_RECEIVED',sent:0,templates:prepared},null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({status:'PREPARED_UNSENT',templates:prepared.length,validTokens:0,realEmailsSent:0,senderAndAllowedRecipientChecked:true,otherRecipientRejected:true,httpsNativeCallbacks:true}));
