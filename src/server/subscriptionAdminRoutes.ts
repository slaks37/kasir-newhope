import type express from 'express';
import type { Db } from '../../services/shared/db';
import { BillingError } from '../../services/billing/engine';
import { ensureSubscription, outletUsage, serializeSubscription } from '../../services/billing/engine';
import { billingQuote, lifecycleStage, subscriptionAccess } from '../config/subscriptionPolicy';
import { DAY_MS, SAAS_PLANS, TRIAL_PLAN_ID } from '../config/saasPlans';

export function registerSubscriptionAdminRoutes(app:express.Express,getDb:()=>Promise<Db>,guard:any,wrap:any) {
  app.get('/api/admin/subscriptions',guard('VIEW_MERCHANT_HEALTH'),wrap(async(req:any,res:any,db:Db)=>{
    const {rows}=await db.query(`SELECT t.id,t.name,t.owner_user_ref,t.created_at,t.is_active,s.id AS subscription_id,s.plan_id,
      s.status,s.current_period_start,s.current_period_end,s.grace_period_end,s.billing_cycle,s.extra_outlets,s.trial_started_at,s.trial_ends_at,
      (SELECT count(*)::int FROM internal.outlets o WHERE o.tenant_id=t.id AND o.is_active) AS outlet_count,
      (SELECT min(r.created_at) FROM contract.merchant_revenue r WHERE r.tenant_id=t.id) AS first_transaction_at,
      (SELECT max(r.created_at) FROM contract.merchant_revenue r WHERE r.tenant_id=t.id) AS last_transaction_at,
      EXISTS(SELECT 1 FROM billing.invoices i WHERE i.tenant_id=t.id AND i.payment_status='PAID' AND i.reconciliation_status='APPLIED') AS converted
      FROM internal.tenants t LEFT JOIN billing.subscriptions s ON s.tenant_id=t.id ORDER BY t.created_at DESC LIMIT 10001`);
    // Bound response work; do not silently report partial platform totals.
    if(rows.length>10000) return res.status(503).json({ok:false,error:'SUBSCRIPTION_REPORT_REQUIRES_PAGINATED_AGGREGATION'});
    const all=rows.map(r=>{
      const end=r.current_period_end || new Date(Date.parse(r.created_at)+45*DAY_MS);
      const access=subscriptionAccess({status:r.is_active?(r.status || 'TRIAL'):'EXPIRED',currentPeriodEnd:new Date(end).toISOString(),gracePeriodEnd:r.grace_period_end?new Date(r.grace_period_end).toISOString():undefined});
      const day=Math.max(1,Math.floor((Date.now()-Date.parse(r.trial_started_at || r.created_at))/DAY_MS)+1);
      return {...r,status:access.status,accessMode:access.accessMode,daysLeft:access.daysLeft,trialDay:day,
        lifecycleStage:r.converted?'CONVERTED':lifecycleStage(day),maxOutlets:(SAAS_PLANS.find(p=>p.id===r.plan_id)?.maxOutlets ?? 2)+Number(r.extra_outlets || 0)};
    });
    const eligible=all.filter(r=>r.trial_started_at || r.plan_id===TRIAL_PLAN_ID || !r.subscription_id);
    const converted=eligible.filter(r=>r.converted).length;
    const summary={active:all.filter(r=>r.status==='ACTIVE').length,trial:all.filter(r=>r.status==='TRIAL').length,
      expired:all.filter(r=>['EXPIRED','PAST_DUE'].includes(r.status)).length,trialEntrants:eligible.length,
      activated:eligible.filter(r=>r.first_transaction_at).length,converted,
      conversionRate:eligible.length?Math.round(converted/eligible.length*1000)/10:0};
    const search=String(req.query.search || '').toLowerCase();
    const filtered=all.filter(r=>(!search || r.name.toLowerCase().includes(search)) && (!req.query.status || r.status===req.query.status));
    const limit=Math.max(1,Math.min(100,Number(req.query.limit)||25)),offset=Math.max(0,Number(req.query.offset)||0);
    res.json({ok:true,rows:filtered.slice(offset,offset+limit),total:filtered.length,limit,offset,summary,plans:SAAS_PLANS,
      canManage:req.internal.role==='ROLE_SUPERADMIN',canSupport:['ROLE_SUPERADMIN','ROLE_INTERNAL_SUPPORT'].includes(req.internal.role)});
  }));
  app.get('/api/admin/payments',guard('MANAGE_SUBSCRIPTION'),wrap(async(_req:any,res:any,db:Db)=>{
    const invoices=await db.query(`SELECT i.*,t.name AS tenant_name FROM billing.invoices i JOIN internal.tenants t ON t.id=i.tenant_id ORDER BY i.created_at DESC LIMIT 200`);
    const events=await db.query('SELECT * FROM billing.payment_events ORDER BY created_at DESC LIMIT 200');
    res.json({ok:true,rows:invoices.rows,events:events.rows});
  }));
  app.get('/api/admin/tenants/:tenantId/support',guard('MANAGE_SUPPORT'),wrap(async(req:any,res:any,db:Db)=>{
    const {rows}=await db.query(`SELECT a.*,u.email AS operator_email FROM internal.support_actions a
      JOIN internal.internal_users u ON u.id=a.internal_user_id WHERE a.tenant_id=$1 ORDER BY a.created_at DESC LIMIT 100`,[req.params.tenantId]);
    res.json({ok:true,rows});
  }));
  app.post('/api/admin/tenants/:tenantId/support',guard('MANAGE_SUPPORT'),async(req:any,res:any)=>{
    try {
      const db=await getDb();
      const reason=String(req.body?.reason || '').trim();
      const action=String(req.body?.action || '');
      if(reason.length<10 || reason.length>2000) throw new BillingError(400,'REASON_MINIMUM_10_CHARACTERS');
      if(!['NOTE','EXTEND_TRIAL','GRANT_PLAN','PAYMENT_NOTE'].includes(action)) throw new BillingError(400,'INVALID_SUPPORT_ACTION');
      if(action!=='NOTE' && req.internal.role!=='ROLE_SUPERADMIN') throw new BillingError(403,'CAPABILITY_DENIED');
      const result=await db.tx(async c=>{
        const tenant=await c.query('SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE',[req.params.tenantId]);
        if(!tenant.rowCount) throw new BillingError(404,'TENANT_NOT_FOUND');
        const before=await ensureSubscription(c,req.params.tenantId);
        if(action==='EXTEND_TRIAL') {
          const days=Number(req.body.days);
          if(!Number.isInteger(days)||days<1||days>14 || before.plan_id!==TRIAL_PLAN_ID) throw new BillingError(400,'INVALID_TRIAL_EXTENSION');
          await c.query(`UPDATE billing.subscriptions SET current_period_end=greatest(current_period_end,now())+$2*interval '1 day',
            grace_period_end=greatest(current_period_end,now())+($2+14)*interval '1 day',status='TRIAL',revision=revision+1,updated_at=now() WHERE id=$1`,[before.id,days]);
        }
        if(action==='GRANT_PLAN') {
          let q;try{q=billingQuote(before,req.body,await outletUsage(c,req.params.tenantId));}catch(e){throw new BillingError(400,(e as Error).message);}
          // Explicit complimentary override, not a fabricated payment.
          await c.query(`UPDATE billing.subscriptions SET plan_id=$2,billing_cycle=$3,extra_outlets=$4,recurring_amount=0,
            status='ACTIVE',current_period_start=$5,current_period_end=$6,grace_period_end=$6::timestamptz+interval '14 days',revision=revision+1,updated_at=now() WHERE id=$1`,
            [before.id,q.planId,q.billingCycle,q.extraOutlets,q.periodStart,q.periodEnd]);
        }
        if(action==='PAYMENT_NOTE') {
          const invoice=await c.query('SELECT id FROM billing.invoices WHERE id=$1 AND tenant_id=$2',[req.body.invoiceId,req.params.tenantId]);
          if(!invoice.rowCount) throw new BillingError(404,'INVOICE_NOT_FOUND');
          await c.query('UPDATE billing.invoices SET reconciliation_note=$2 WHERE id=$1',[req.body.invoiceId,reason]);
        }
        const after=(await c.query('SELECT * FROM billing.subscriptions WHERE id=$1',[before.id])).rows[0];
        // Required audit and mutation share one transaction: audit failure rolls
        // back the grant/extension. There is no best-effort success here.
        await c.query(`INSERT INTO internal.support_actions(tenant_id,internal_user_id,action,reason,before_state,after_state)
          VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,[req.params.tenantId,req.internal.id,action,reason,JSON.stringify(before),JSON.stringify({...after,invoiceId:req.body.invoiceId})]);
        return serializeSubscription(after);
      });
      res.json({ok:true,subscription:result});
    }catch(err){res.status(err instanceof BillingError?err.status:500).json({ok:false,error:err instanceof BillingError?err.message:'SUPPORT_ACTION_FAILED'});}
  });
}
