import {randomUUID,randomBytes} from 'node:crypto';
import type {Express} from 'express';
import type {Db} from '../shared/db';
import {trustedPrincipal} from '../shared/auth';
import {hybridPhase1Config} from '../shared/hybridPhase1';
import {SAAS_PLANS,TRIAL_PLAN_ID} from '../../src/config/saasPlans';
const sectors=new Set(['FNB','RETAIL','LAUNDRY','BARBERSHOP','CARWASH']);
const label=(v:unknown,fallback:string,max:number)=>typeof v==='string'&&v.trim()?v.trim().slice(0,max):fallback;
/** Source UUID is the principal, never a destination/email mapping. */
export function registerHybridOnboarding(app:Express,db:Db){
 if(process.env.NEON_DB_PHASE1!=='1')return;
 app.get('/api/v1/sync/identity',(req,res)=>{const p=trustedPrincipal(req);res.setHeader('Cache-Control','no-store');if(!p)return res.status(401).json({ok:false,error:'UNAUTHENTICATED'});return res.json({ok:true,subject:p.subject,provider:'supabase',identityRemapped:false});});
 app.post('/api/v1/sync/hybrid-onboarding',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');const p=trustedPrincipal(req);
  if(!p?.isEmailVerified||!p.email)return res.status(403).json({ok:false,error:'VERIFIED_SOURCE_ACCOUNT_REQUIRED'});
  try{hybridPhase1Config();const result=await db.tx(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['hybrid-onboarding:'+p.subject]);
   const tenant=(await c.query('SELECT id FROM internal.tenants WHERE owner_user_ref=$1',[p.subject])).rows;
   if(tenant.length)return {created:false};
   const profile=(await c.query('SELECT id FROM internal.users WHERE id=$1',[p.subject])).rows.length;
   const member=(await c.query('SELECT 1 FROM internal.memberships WHERE user_id=$1',[p.subject])).rows.length;
   const old=(await c.query('SELECT 1 FROM internal.hybrid_source_accounts WHERE source_uuid=$1',[p.subject])).rows.length;
   // Existing source accounts are never promoted or silently given a new tenant.
   if(profile||member||old)return {created:false,recoveryRequired:!member};
   const state=(await c.query('SELECT source_cutover_at,signup_provisioning_enabled FROM internal.hybrid_phase1_state WHERE singleton')).rows[0];
   if(!state?.signup_provisioning_enabled)throw Error('HYBRID_NEW_SIGNUPS_PAUSED');
   const created=Date.parse(p.sourceCreatedAt||'');if(!Number.isFinite(created)||created<=new Date(state.source_cutover_at).getTime()||created>Date.now()+30000)throw Error('SOURCE_CREATION_PROOF_REQUIRED');
   if((await c.query('SELECT 1 FROM internal.users WHERE lower(email)=lower($1)',[p.email])).rows.length)throw Error('SOURCE_UUID_EMAIL_CONFLICT_REQUIRES_REVIEW');
   const id=randomUUID(),name=label(req.body?.store_name,'Toko Baru',100),owner=label(req.body?.full_name,'Pemilik Toko',150),sector=sectors.has(req.body?.business_sector)?req.body.business_sector:'FNB';
   const first=label(req.body?.first_outlet_name,name+' (Cabang Utama)',150),second=label(req.body?.second_outlet_name,'',150);
   await c.query('INSERT INTO internal.users(id,email,full_name,is_active) VALUES($1,lower($2),$3,true)',[p.subject,p.email,owner]);
   await c.query('INSERT INTO internal.tenants(id,name,business_sector,owner_user_ref,owner_user_id,is_active) VALUES($1,$2,$3,$4::text,$4::uuid,true)',[id,name,sector,p.subject]);
   await c.query('INSERT INTO pos.tenants(id,name,business_sector,owner_user_ref,is_active) VALUES($1,$2,$3,$4,true)',[id,name,sector,p.subject]);
   await c.query('INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref,is_active) VALUES($1,$1,$2,$3,$4,true)',[id,name,sector,`${p.subject}_${sector}`]);
   for(const outlet of second&&second!==first?[first,second]:[first])await c.query('INSERT INTO internal.outlets(id,tenant_id,merchant_id,name,is_active) VALUES($1,$2,$2,$3,true)',[randomUUID(),id,outlet]);
   await c.query("INSERT INTO internal.memberships(id,user_id,tenant_id,merchant_id,role,pin,is_active) VALUES($1,$2,$3,$3,'OWNER',$4,true)",[randomUUID(),p.subject,id,randomBytes(32).toString('hex')]);
   await c.query("INSERT INTO billing.subscriptions(id,tenant_id,plan_id,status,current_period_start,current_period_end,grace_period_end,trial_started_at,trial_ends_at,has_used_trial) VALUES($1,$2,'plan-free','TRIAL',now(),now()+interval '45 days',now()+interval '59 days',now(),now()+interval '45 days',true)",[randomUUID(),id]);
   await c.query("INSERT INTO ai.merchant_ai_credits(merchant_id,tenant_id,balance,monthly_grant,used_this_month,period_reset_at) VALUES($1,$1,$2,$2,0,date_trunc('month',now())+interval '1 month')",[id,SAAS_PLANS.find(v=>v.id===TRIAL_PLAN_ID)!.aiQuotaMonthly]);
   return {created:true};
  });return res.json({ok:true,identityRemapped:false,...result});
  }catch(e){const code=e instanceof Error?e.message:'';return res.status(code==='HYBRID_NEW_SIGNUPS_PAUSED'?503:409).json({ok:false,error:['HYBRID_NEW_SIGNUPS_PAUSED','SOURCE_CREATION_PROOF_REQUIRED','SOURCE_UUID_EMAIL_CONFLICT_REQUIRES_REVIEW'].includes(code)?code:'HYBRID_ONBOARDING_REVIEW_REQUIRED'});}
 });
}
