// Only imported by isolated tests/fixtures; never bundled by an app handler.
import {randomUUID} from 'node:crypto';
import type {Db} from '../../services/shared/db';
import {dokuCredentialFingerprint} from '../../services/billing/paymentReadiness';
export function futureDokuExpiry(){return new Date(Date.now()+3600000+7*3600000).toISOString().slice(0,19).replace(/[-:T]/g,'');}
export async function acceptSyntheticSandbox(db:Db){
 if(process.env.DOKU_API_URL!=='https://api-sandbox.doku.com'||process.env.NODE_ENV==='production')throw Error('SYNTHETIC_SANDBOX_ONLY');
 const id=randomUUID();process.env.DOKU_ACCEPTANCE_ID=id;process.env.DOKU_RELEASE_SCOPE='pilot';
 await db.query(`INSERT INTO billing.doku_release_acceptances(id,scope,api_url,credential_sha256,channels,owner_approval_ref,provider_evidence_sha256,credentials_verified_at,webhook_verified_at,expires_at)
 VALUES($1,'SANDBOX','https://api-sandbox.doku.com',$2,$3,'SYNTHETIC_ONLY_NOT_PROVIDER_ACCEPTANCE',$4,now(),now(),now()+interval '1 hour')`,[id,dokuCredentialFingerprint(),process.env.DOKU_ALLOWED_CHANNELS!.split(','),'0'.repeat(64)]);
 return id;
}
