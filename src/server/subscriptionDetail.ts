import type { Db } from '../../services/shared/db';
import { DAY_MS, SAAS_PLANS, TRIAL_PLAN_ID } from '../config/saasPlans';
import { subscriptionAccess } from '../config/subscriptionPolicy';

// Read-only snapshot: opening a detail page must never create a subscription.
export async function subscriptionDetail(db: Db, tenantId: string) {
  return db.tx(async c => {
    await c.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tenant = (await c.query('SELECT id,name,created_at,is_active FROM internal.tenants WHERE id=$1', [tenantId])).rows[0];
    if (!tenant) return null;
    const stored = (await c.query('SELECT * FROM billing.subscriptions WHERE tenant_id=$1', [tenantId])).rows[0];
    const start = new Date(tenant.created_at).toISOString();
    const end = new Date(Date.parse(start) + 45 * DAY_MS).toISOString();
    const s = stored || {plan_id:TRIAL_PLAN_ID,status:'TRIAL',current_period_start:start,current_period_end:end,
      grace_period_end:new Date(Date.parse(end)+14*DAY_MS).toISOString(),trial_started_at:start,trial_ends_at:end,extra_outlets:0};
    const plan = SAAS_PLANS.find(p => p.id === s.plan_id);
    const access = subscriptionAccess({status:tenant.is_active?s.status:'EXPIRED',currentPeriodEnd:new Date(s.current_period_end).toISOString(),
      gracePeriodEnd:s.grace_period_end?new Date(s.grace_period_end).toISOString():undefined});
    const outlets = (await c.query('SELECT id,name,is_active FROM internal.outlets WHERE tenant_id=$1 ORDER BY name,id LIMIT 201', [tenantId])).rows;
    const usage = (await c.query('SELECT count(*)::int AS used FROM internal.outlets WHERE tenant_id=$1 AND is_active', [tenantId])).rows[0].used;
    const invoices = (await c.query(`SELECT id,invoice_number,amount,currency,payment_status,reconciliation_status,reconciliation_note,created_at,due_date
      FROM billing.invoices WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 101`, [tenantId])).rows;
    const payments = (await c.query(`SELECT e.id,e.invoice_number,e.amount,e.currency,e.outcome,e.reason,e.created_at
      FROM billing.payment_events e WHERE EXISTS(SELECT 1 FROM billing.invoices i WHERE i.tenant_id=$1 AND i.invoice_number=e.invoice_number)
      ORDER BY e.created_at DESC,e.id DESC LIMIT 101`, [tenantId])).rows;
    const support = (await c.query(`SELECT a.id,a.action,a.reason,a.created_at,a.request_id,u.email AS operator_email
      FROM internal.support_actions a JOIN internal.internal_users u ON u.id=a.internal_user_id
      WHERE a.tenant_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 51`, [tenantId])).rows;
    const activity = (await c.query('SELECT min(created_at) AS first_transaction_at,max(created_at) AS last_transaction_at FROM contract.merchant_revenue WHERE tenant_id=$1', [tenantId])).rows[0];
    const cap = plan ? plan.maxOutlets + Number(s.extra_outlets || 0) : null;
    return {tenant,retrievedAt:new Date().toISOString(),derivedTrial:!stored,activity,
      subscription:{planId:s.plan_id,planName:plan?.name || s.plan_id,billingCycle:s.billing_cycle || null,
        periodStart:s.current_period_start,periodEnd:s.current_period_end,graceEnd:s.grace_period_end,
        trialStart:s.trial_started_at,trialEnd:s.trial_ends_at,recurringAmount:s.recurring_amount ?? null,...access},
      capacity:{included:plan?.maxOutlets ?? null,extra:Number(s.extra_outlets || 0),used:usage,max:cap,remaining:cap===null?null:Math.max(0,cap-usage)},
      outlets:outlets.slice(0,200),invoices:invoices.slice(0,100),payments:payments.slice(0,100),support:support.slice(0,50),
      truncated:{outlets:outlets.length>200,invoices:invoices.length>100,payments:payments.length>100,support:support.length>50}};
  });
}
