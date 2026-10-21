import {externalPayment} from '../../services/billing/externalPayment';
import {financialReviewHold,providerOrderTerminal} from '../../services/billing/invoicePaymentPolicy';
import type express from 'express';
import { subscriptionDetail } from './subscriptionDetail';
import type { Db } from '../../services/shared/db';
import { BillingError } from '../../services/billing/engine';
import { ensureSubscription, outletUsage, serializeSubscription } from '../../services/billing/engine';
import { manualTierChange, lifecycleStage } from '../config/subscriptionPolicy';
import { DAY_MS, SAAS_PLANS, TRIAL_PLAN_ID } from '../config/saasPlans';
import {accountSubscription} from '../config/accountSubscription';

export function registerSubscriptionAdminRoutes(app:express.Express,getDb:()=>Promise<Db>,guard:any,wrap:any) {
  app.get('/api/admin/tenants/:tenantId/subscription-detail',guard('VIEW_MERCHANT_DETAIL'),wrap(async(req:any,res:any,db:Db)=>{
    const detail=await subscriptionDetail(db,req.params.tenantId);
    if(!detail)return res.status(404).json({ok:false,error:'TENANT_NOT_FOUND'});
    res.json({ok:true,...detail});
  }));
  app.get('/api/admin/subscriptions',guard('VIEW_MERCHANT_HEALTH'),wrap(async(req:any,res:any,db:Db)=>{
    const search=String(req.query.search || '').trim().toLowerCase().slice(0,100);
    // Aggregate each source once per account set, not one ledger scan for MIN
    // and another for MAX for every tenant. Keep the canonical JS entitlement
    // policy; SQL supplies facts, not a competing plan/status calculation.
    const {rows}=await db.query(`WITH accounts AS MATERIALIZED (
      SELECT id,name,created_at,is_active FROM internal.tenants
      WHERE merged_into IS NULL ORDER BY created_at DESC,id LIMIT 10001
    ), outlet_facts AS (
      SELECT o.tenant_id,count(*)::int AS outlet_count FROM internal.outlets o
      JOIN accounts a ON a.id=o.tenant_id WHERE o.is_active GROUP BY o.tenant_id
    ), revenue_facts AS (
      SELECT r.tenant_id,min(r.created_at) AS first_transaction_at,max(r.created_at) AS last_transaction_at
      FROM contract.merchant_revenue r JOIN accounts a ON a.id=r.tenant_id GROUP BY r.tenant_id
    ), paid_accounts AS (
      SELECT DISTINCT i.tenant_id FROM billing.invoices i JOIN accounts a ON a.id=i.tenant_id
      WHERE i.payment_status='PAID' AND i.reconciliation_status='APPLIED'
    ), matching_businesses AS (
      SELECT DISTINCT m.tenant_id FROM internal.merchants m JOIN accounts a ON a.id=m.tenant_id
      WHERE $1<>'' AND position($1 in lower(m.name))>0
    ) SELECT t.id,t.name,t.created_at,t.is_active,s.id AS subscription_id,s.plan_id,
      s.status,s.current_period_start,s.current_period_end,s.grace_period_end,s.billing_cycle,s.extra_outlets,s.trial_started_at,s.trial_ends_at,to_jsonb(s)->'free_selection' AS free_selection,
      coalesce(o.outlet_count,0)::int AS outlet_count,r.first_transaction_at,r.last_transaction_at,
      p.tenant_id IS NOT NULL AS converted,m.tenant_id IS NOT NULL AS matches_business
      FROM accounts t LEFT JOIN billing.subscriptions s ON s.tenant_id=t.id
      LEFT JOIN outlet_facts o ON o.tenant_id=t.id LEFT JOIN revenue_facts r ON r.tenant_id=t.id
      LEFT JOIN paid_accounts p ON p.tenant_id=t.id LEFT JOIN matching_businesses m ON m.tenant_id=t.id
      ORDER BY t.created_at DESC,t.id`,[search]);
    // Bound response work; do not silently report partial platform totals.
    if(rows.length>10000) return res.status(503).json({ok:false,error:'SUBSCRIPTION_REPORT_REQUIRES_PAGINATED_AGGREGATION'});
    const all=rows.map(r=>{
      const {subscription:access,capacity}=accountSubscription(r,r.subscription_id?r:null,r.outlet_count);
      const effectivePlanId=access.planId;
      const day=Math.max(1,Math.floor((Date.now()-Date.parse(r.trial_started_at || r.created_at))/DAY_MS)+1);
      return {...r,outlet_count:capacity.used,retained_outlet_count:r.outlet_count,plan_id:effectivePlanId,extra_outlets:access.status==='FREE'?0:r.extra_outlets,status:access.status,accessMode:access.accessMode,daysLeft:access.daysLeft,trialDay:day,
        lifecycleStage:r.converted?'CONVERTED':lifecycleStage(day),maxOutlets:capacity.max};
    });
    const eligible=all.filter(r=>r.trial_started_at || r.plan_id===TRIAL_PLAN_ID || !r.subscription_id);
    const converted=eligible.filter(r=>r.converted).length;
    const summary={active:all.filter(r=>r.status==='ACTIVE').length,trial:all.filter(r=>r.status==='TRIAL').length,
      expired:all.filter(r=>['EXPIRED','PAST_DUE'].includes(r.status)).length,trialEntrants:eligible.length,
      activated:eligible.filter(r=>r.first_transaction_at).length,converted,
      conversionRate:eligible.length?Math.round(converted/eligible.length*1000)/10:0};
    const filtered=all.filter(r=>(!search || r.name.toLowerCase().includes(search)||r.matches_business) && (!req.query.status || r.status===req.query.status));
    const limit=Math.max(1,Math.min(100,Number(req.query.limit)||25)),offset=Math.max(0,Number(req.query.offset)||0);
    const page=filtered.slice(offset,offset+limit);
    // One paginated account row owns one subscription. List its actual merchant
    // children in a single batch, never JOIN them into duplicate billing rows.
    const businesses=page.length?(await db.query(`SELECT m.id,m.tenant_id,m.name,m.business_sector,m.is_active,
      count(o.id) FILTER(WHERE o.is_active)::int AS active_outlets
      FROM internal.merchants m LEFT JOIN internal.outlets o ON o.merchant_id=m.id AND o.tenant_id=m.tenant_id
      WHERE m.tenant_id=ANY($1::uuid[]) GROUP BY m.id ORDER BY m.name,m.id`,[page.map(row=>row.id)])).rows:[];
    const byTenant=new Map<string,any[]>();for(const business of businesses){const group=byTenant.get(business.tenant_id)||[];group.push(business);byTenant.set(business.tenant_id,group);}
    res.json({ok:true,rows:page.map(({matches_business,free_selection,...row})=>({...row,businesses:byTenant.get(row.id)||[]})),total:filtered.length,limit,offset,summary,plans:SAAS_PLANS,
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
      if(!['NOTE','EXTEND_TRIAL','GRANT_PLAN','PAYMENT_NOTE','ISSUE_EXTERNAL_QUOTE','VERIFY_EXTERNAL_PAYMENT'].includes(action)) throw new BillingError(400,'INVALID_SUPPORT_ACTION');
      if(action!=='NOTE' && req.internal.role!=='ROLE_SUPERADMIN') throw new BillingError(403,'CAPABILITY_DENIED');
      const result=await db.tx(async c=>{
        const tenant=await c.query('SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE',[req.params.tenantId]);
        if(!tenant.rowCount) throw new BillingError(404,'TENANT_NOT_FOUND');
        const before=await ensureSubscription(c,req.params.tenantId);
        let invoiceBefore:any=null,invoiceAfter:any=null;
        const external=['ISSUE_EXTERNAL_QUOTE','VERIFY_EXTERNAL_PAYMENT'].includes(action)?await externalPayment(c,req.params.tenantId,req.internal.id,action,req.body):null;
        if(action==='EXTEND_TRIAL') {
          const days=Number(req.body.days);
          if(!Number.isInteger(days)||days<1||days>14 || before.plan_id!==TRIAL_PLAN_ID) throw new BillingError(400,'INVALID_TRIAL_EXTENSION');
          await c.query(`UPDATE billing.subscriptions SET current_period_end=greatest(current_period_end,now())+$2*interval '1 day',
            grace_period_end=greatest(current_period_end,now())+($2+14)*interval '1 day',status='TRIAL',revision=revision+1,updated_at=now() WHERE id=$1`,[before.id,days]);
        }
        if(action==='GRANT_PLAN') {
          let q;try{q=manualTierChange(before,req.body,await outletUsage(c,req.params.tenantId));}catch(e){throw new BillingError(400,(e as Error).message);}
          // Explicit complimentary override, not a fabricated payment.
          await c.query(`UPDATE billing.subscriptions SET plan_id=$2,billing_cycle=$3,extra_outlets=$4,recurring_amount=$7,
            status='ACTIVE',current_period_start=$5,current_period_end=$6,grace_period_end=$6::timestamptz+interval '14 days',revision=revision+1,updated_at=now() WHERE id=$1`,
            [before.id,q.planId,q.billingCycle,q.extraOutlets,q.periodStart,q.periodEnd,q.recurringAmount]);
        }
        if(action==='PAYMENT_NOTE') {
          const invoice=await c.query('SELECT id,reconciliation_note,reconciliation_status,payment_status FROM billing.invoices WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[req.body.invoiceId,req.params.tenantId]);
          if(!invoice.rowCount) throw new BillingError(404,'INVOICE_NOT_FOUND');
          invoiceBefore=invoice.rows[0];
          // PAYMENT_NOTE is commentary, never financial state resolution.
          // Keep machine holds/expiry intact; the comment is always retained
          // in the required immutable support_actions audit below.
          const protectedState=financialReviewHold(invoiceBefore) || providerOrderTerminal(invoiceBefore) || invoiceBefore.reconciliation_note==='PROVIDER_EXPIRED';
          if(!protectedState)await c.query('UPDATE billing.invoices SET reconciliation_note=$2 WHERE id=$1',[req.body.invoiceId,reason]);
          invoiceAfter={...invoiceBefore,reconciliation_note:protectedState?invoiceBefore.reconciliation_note:reason};
        }
        const after=(await c.query('SELECT * FROM billing.subscriptions WHERE id=$1',[before.id])).rows[0];
        // Required audit and mutation share one transaction: audit failure rolls
        // back the grant/extension. There is no best-effort success here.
        await c.query(`INSERT INTO internal.support_actions(tenant_id,internal_user_id,action,reason,before_state,after_state,request_id,ip_address,user_agent)
          VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)`,[req.params.tenantId,req.internal.id,action,reason,
          JSON.stringify({...before,invoice:invoiceBefore}),JSON.stringify({...after,invoice:invoiceAfter,external}),req.auditRequestId,
          req.ip || null,String(req.headers['user-agent'] || '').slice(0,512)]);
        return {subscription:serializeSubscription(after),external};
      });
      res.json({ok:true,...result});
    }catch(err){res.status(err instanceof BillingError?err.status:500).json({ok:false,error:err instanceof BillingError?err.message:'SUPPORT_ACTION_FAILED'});}
  });
}
