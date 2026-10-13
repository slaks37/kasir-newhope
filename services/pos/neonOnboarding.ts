import {randomUUID,randomBytes} from 'node:crypto';
import type {Express} from 'express';
import type {Db} from '../shared/db';
import {trustedPrincipal} from '../shared/auth';
import {neonPilotConfig} from '../shared/neonPilot';
import {betterAuthPilotConfig} from '../shared/betterAuthPilot';
import {SAAS_PLANS,TRIAL_PLAN_ID} from '../../src/config/saasPlans';

const sectors=new Set(['FNB','RETAIL','LAUNDRY','CARWASH','BARBERSHOP']);
const label=(v:unknown,fallback:string,max:number)=>typeof v==='string'&&v.trim()?v.trim().slice(0,max):fallback;
export function registerNeonOnboarding(app:Express,db:Db) {
  app.get('/api/v1/sync/identity',(req,res)=>{
    const p=trustedPrincipal(req);
    res.setHeader('Cache-Control','no-store');
    return p?res.json({ok:true,subject:p.subject}):res.status(401).json({ok:false,error:'UNAUTHENTICATED'});
  });
  app.post('/api/v1/sync/neon-onboarding',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!['neon','better-auth'].includes(process.env.AUTH_PROVIDER||''))return res.status(404).json({ok:false,error:'NOT_FOUND'});
    const p=trustedPrincipal(req);
    if(!p?.isEmailVerified || !p.email)return res.status(403).json({ok:false,error:'VERIFIED_ACCOUNT_REQUIRED'});
    try {
      const issuer=process.env.AUTH_PROVIDER==='better-auth'?betterAuthPilotConfig().baseUrl:neonPilotConfig().issuer;
      const result=await db.tx(async c=>{
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['onboarding:'+p.subject]);
        const binding=(await c.query(`SELECT verification_ref FROM internal.auth_identity_bindings
          WHERE provider=$3 AND issuer=$1 AND canonical_user_id=$2 AND is_active`,[issuer,p.subject,process.env.AUTH_PROVIDER])).rows[0];
        const existing=(await c.query('SELECT id FROM internal.tenants WHERE owner_user_ref=$1',[p.subject])).rows;
        if(existing.length)return {tenantId:existing[0].id,created:false};
        // No provisioning of imported identities, staff, or inactive owners.
        const member=(await c.query('SELECT 1 FROM internal.memberships WHERE user_id=$1',[p.subject])).rows.length;
        if(!binding || binding.verification_ref!=='NEW_VERIFIED_ACCOUNT' || member)throw Error('IDENTITY_REVIEW_REQUIRED');
        const id=randomUUID(),name=label(req.body?.store_name,'Toko Baru',100);
        const fullName=label(req.body?.full_name,'Pemilik Toko',150);
        const sector=sectors.has(req.body?.business_sector)?req.body.business_sector:'FNB';
        const first=label(req.body?.first_outlet_name,name+' (Cabang Utama)',150);
        const second=label(req.body?.second_outlet_name,'',150);
        await c.query('UPDATE internal.users SET full_name=$2 WHERE id=$1',[p.subject,fullName]);
        await c.query(`INSERT INTO internal.tenants(id,name,business_sector,owner_user_ref,owner_user_id,is_active)
          VALUES($1,$2,$3,$4::text,$4::uuid,true)`,[id,name,sector,p.subject]);
        await c.query('INSERT INTO pos.tenants(id,name,business_sector,owner_user_ref) VALUES($1,$2,$3,$4)',[id,name,sector,p.subject]);
        await c.query('INSERT INTO internal.merchants(id,tenant_id,name,business_sector) VALUES($1,$1,$2,$3)',[id,name,sector]);
        for(const outlet of second && second!==first?[first,second]:[first])await c.query(
          'INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$2,$3)',[randomUUID(),id,outlet]);
        await c.query(`INSERT INTO internal.memberships(id,user_id,tenant_id,merchant_id,role,pin,is_active)
          VALUES($1,$2,$3,$3,'OWNER',$4,true)`,[randomUUID(),p.subject,id,randomBytes(32).toString('hex')]);
        await c.query(`INSERT INTO billing.subscriptions(id,tenant_id,plan_id,status,current_period_start,current_period_end,
          grace_period_end,trial_started_at,trial_ends_at,has_used_trial)
          VALUES($1,$2,'plan-free','TRIAL',now(),now()+interval '45 days',now()+interval '59 days',now(),now()+interval '45 days',true)`,[randomUUID(),id]);
        await c.query(`INSERT INTO ai.merchant_ai_credits(merchant_id,tenant_id,balance,monthly_grant,used_this_month,period_reset_at)
          VALUES($1,$1,$2,$2,0,date_trunc('month',now())+interval '1 month')`,[id,SAAS_PLANS.find(p=>p.id===TRIAL_PLAN_ID)!.aiQuotaMonthly]);
        return {tenantId:id,created:true};
      });
      return res.json({ok:true,...result});
    }catch{return res.status(409).json({ok:false,error:'NEON_ONBOARDING_REVIEW_REQUIRED'});}
  });
}
