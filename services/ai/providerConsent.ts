import type {Db} from '../shared/db';
import {PAID_DATA_CONSENT} from './paidPrivacy';
export async function providerConsent(db:Db,subject:string,businessId:string,granted?:boolean){
 return db.tx(async c=>{
  const scope=(await c.query(`SELECT m.id,m.tenant_id FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
   WHERE (m.id::text=$1 OR m.external_ref=$1) AND t.owner_user_ref=$2 AND t.is_active AND m.is_active AND t.merged_into IS NULL`,[businessId,subject])).rows[0];
  if(!scope)throw new Error('AI_CONSENT_OWNER_REQUIRED');
  await c.query("SELECT set_config('app.tenant_id',$1,true)",[scope.tenant_id]);
  // Serialize changes and queries for this merchant; two UI toggles cannot race.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['ai-consent:'+scope.id]);
  const latest=(await c.query('SELECT granted,notice_version FROM ai.provider_consent_events WHERE merchant_id=$1 AND actor_ref=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[scope.id,subject])).rows[0];
  if(typeof granted==='boolean'&&(latest?.granted!==granted||latest?.notice_version!==PAID_DATA_CONSENT))await c.query(`INSERT INTO ai.provider_consent_events(tenant_id,merchant_id,actor_ref,notice_version,purpose,providers,granted) VALUES($1,$2,$3,$4,'BUSINESS_ANALYSIS',ARRAY['Agnes AI','DeepSeek'],$5)`,[scope.tenant_id,scope.id,subject,PAID_DATA_CONSENT,granted]);
  return typeof granted==='boolean'?granted:latest?.granted===true&&latest?.notice_version===PAID_DATA_CONSENT;
 });
}
