import {createHash} from 'node:crypto';
import type {Db} from '../shared/db';
import {getDokuApiUrl,getDokuClientId,getDokuSecretKey} from '../../api/_doku';
import {dokuSubscriptionPolicy} from './dokuSubscriptionPolicy';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function checkoutPilotAllowed(tenantId:string,env=process.env):boolean {
 if(env.DOKU_RELEASE_SCOPE==='public')return true;
 const ids=(env.DOKU_CHECKOUT_PILOT_TENANTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 return ids.length>0&&ids.every(x=>UUID.test(x))&&ids.includes(tenantId.toLowerCase());
}
/** Fingerprint binds acceptance to credentials without storing the secret. */
export function dokuCredentialFingerprint(){
 return createHash('sha256').update(JSON.stringify([getDokuApiUrl(),getDokuClientId(),getDokuSecretKey()])).digest('hex');
}
export async function assertDokuReadiness(db:Db,tenantId:string){
 if(process.env.DOKU_PAYMENTS_ENABLED!=='1')throw Error('PAYMENTS_PAUSED');
 const policy=dokuSubscriptionPolicy(),api=getDokuApiUrl(),origin=process.env.PUBLIC_APP_URL;
 if(!getDokuClientId()||!getDokuSecretKey()||!process.env.DOKU_API_URL||!origin||new URL(origin).origin!==origin||!origin.startsWith('https://'))throw Error('PAYMENT_CONFIGURATION_INVALID');
 const live=api==='https://api.doku.com',scope=process.env.DOKU_RELEASE_SCOPE||'pilot';
 if(!['pilot','public'].includes(scope)||!checkoutPilotAllowed(tenantId))throw Error('CHECKOUT_PILOT_ONLY');
 if(live&&(process.env.FULL_NEON_CLEAN_START!=='1'||process.env.FULL_NEON_TARGET!=='production'||process.env.VERCEL_ENV!=='production'||process.env.AUTH_PROVIDER!=='neon'||origin!=='https://kasir.newhope.space'||process.env.DOKU_ACTIVATION_APPROVED!=='1'))throw Error('DOKU_LIVE_APPROVAL_REQUIRED');
 if(!live&&(process.env.VERCEL_ENV==='production'||process.env.FULL_NEON_TARGET==='production'))throw Error('DOKU_ENVIRONMENT_MISMATCH');
 const id=process.env.DOKU_ACCEPTANCE_ID;
 if(!id||!UUID.test(id))throw Error('DOKU_PROVIDER_ACCEPTANCE_REQUIRED');
 const row=(await db.query(`SELECT * FROM billing.doku_release_acceptances WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() AND approved_at<=clock_timestamp() AND credentials_verified_at<=clock_timestamp() AND webhook_verified_at<=clock_timestamp() AND (live_payment_verified_at IS NULL OR live_payment_verified_at<=clock_timestamp())`,[id])).rows[0];
 if(!row||row.api_url!==api||row.credential_sha256!==dokuCredentialFingerprint()||!row.credentials_verified_at||!row.webhook_verified_at||
  policy.methods.length!==row.channels.length||policy.methods.some(x=>!row.channels.includes(x))||
  (live?row.scope!==(scope==='public'?'PUBLIC':'PILOT'):row.scope!=='SANDBOX')||
  live&&scope==='pilot'&&!row.allowed_tenants.includes(tenantId)||live&&scope==='public'&&!row.live_payment_verified_at)throw Error('DOKU_PROVIDER_ACCEPTANCE_REQUIRED');
 return {acceptanceId:id,scope:row.scope as string,methods:policy.methods,mode:policy.mode,integration:policy.integration};
}
export async function paymentAvailability(db:Db,tenantId:string){
 try{const r=await assertDokuReadiness(db,tenantId);return {enabled:true,methods:r.methods};}
 catch{return {enabled:false,methods:[] as string[]};}
}
