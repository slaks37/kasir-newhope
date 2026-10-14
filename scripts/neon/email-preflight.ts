import fs from 'node:fs';
import {parse} from 'dotenv';
import {betterAuthPilotConfig} from '../../services/shared/betterAuthPilot';
import {authEmailPayload} from '../../services/shared/betterAuthEmail';

// Read-only local checks; never send an email or print a private environment.
const index=process.argv.indexOf('--env'),file=index>=0?process.argv[index+1]:'.env.better-auth-staging.local';
if(!file||(fs.statSync(file).mode&0o077))throw Error('AUTH_EMAIL_PRIVATE_ENV_REQUIRED');
const env=parse(fs.readFileSync(file)),checks:Record<string,boolean>={};
let config:ReturnType<typeof betterAuthPilotConfig>|undefined;
try{config=betterAuthPilotConfig(env);checks.targetAndAuthConfig=true;}catch{checks.targetAndAuthConfig=false;}
checks.https=Boolean(config?.baseUrl.startsWith('https://'));
checks.senderPresent=Boolean(env.AUTH_EMAIL_FROM);
checks.sendingKeyPresent=Boolean(env.RESEND_API_KEY);
checks.verifiedDomainConfigured=env.AUTH_EMAIL_VERIFIED_DOMAIN==='kasir.newhope.space';
checks.emailEnabled=env.AUTH_EMAIL_ENABLED==='1';
checks.previewRecipientRestricted=Boolean(env.AUTH_EMAIL_ALLOWED_RECIPIENTS)&&['preview','staging'].includes(env.VERCEL_ENV||env.APP_ENV||'');
try{
  const origin=config?.baseUrl||'https://missing.invalid';
  authEmailPayload({kind:'RESET',email:'stefen@newsystem.space',baseUrl:origin,url:origin+'/api/auth/reset-password/private-preflight-token?callbackURL='+encodeURIComponent(origin+'/reset-password')},env);
  checks.payloadGates=true;
}catch{checks.payloadGates=false;}
const ready=Object.values(checks).every(Boolean);
console.log(JSON.stringify({status:ready?'READY_FOR_OWNER_APPROVED_DELIVERY_TEST':'BLOCKED',scope:'Read-only; no message sent; secret values omitted',checks,deliveryAcceptance:'NOT_TESTED',ownerSendAuthorization:'REQUIRED'}));
if(!ready)process.exitCode=2;
