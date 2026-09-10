import { randomUUID } from 'node:crypto';
import type { Db } from '../shared/db';
import { billingQuote, lifecycleStage, subscriptionAccess } from '../../src/config/subscriptionPolicy';
import { DAY_MS, findSaaSPlan, TRIAL_DAYS, TRIAL_PLAN_ID } from '../../src/config/saasPlans';

export class BillingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function ensureSubscription(db: Db, tenantId: string) {
  // Caller has already authenticated ownership. Creation anchored to tenant
  // signup, with a unique tenant constraint to survive concurrent requests.
  await db.query(`INSERT INTO billing.subscriptions
    (id,tenant_id,plan_id,status,current_period_start,current_period_end,grace_period_end,trial_started_at,trial_ends_at)
    SELECT $1,id,$3,'TRIAL',created_at,created_at+interval '45 days',created_at+interval '59 days',created_at,created_at+interval '45 days'
    FROM internal.tenants WHERE id=$2 ON CONFLICT(tenant_id) DO NOTHING`, [randomUUID(),tenantId,TRIAL_PLAN_ID]);
  const { rows } = await db.query('SELECT * FROM billing.subscriptions WHERE tenant_id=$1', [tenantId]);
  if (!rows[0]) throw new BillingError(404,'TENANT_NOT_FOUND');
  return rows[0];
}

export function serializeSubscription(s: any) {
  const iso = (x: any) => new Date(x).toISOString();
  return { id:s.id,tenantId:s.tenant_id,planId:s.plan_id,status:s.status,plan:findSaaSPlan(s.plan_id),
    currentPeriodStart:iso(s.current_period_start),currentPeriodEnd:iso(s.current_period_end),
    gracePeriodEnd:s.grace_period_end ? iso(s.grace_period_end) : undefined,
    billingCycle:s.billing_cycle,extraOutlets:s.extra_outlets,
    trialStartedAt:s.trial_started_at ? iso(s.trial_started_at) : null,
    trialEndsAt:s.trial_ends_at ? iso(s.trial_ends_at) : null };
}
export function serializeInvoice(i: any) {
  return { id:i.id,invoiceNumber:i.invoice_number,subscriptionId:i.subscription_id,tenantId:i.tenant_id,
    amount:Number(i.amount),currency:i.currency,paymentStatus:i.payment_status,paymentGatewayRef:i.payment_gateway_ref,
    paymentLinkUrl:i.payment_link_url,paidAt:i.paid_at,dueDate:i.due_date,createdAt:i.created_at,
    planName:i.quote?.planName || 'Tagihan legacy',billingCycle:i.quote?.billingCycle,
    extraOutlets:i.quote?.extraOutlets,reconciliationStatus:i.reconciliation_status };
}
export async function outletUsage(db: Db, tenantId: string) {
  const { rows } = await db.query('SELECT count(*)::int AS count FROM internal.outlets WHERE tenant_id=$1 AND is_active',[tenantId]);
  return Number(rows[0].count);
}
export async function subscriptionStatus(db: Db, tenantId: string) {
  const s = await ensureSubscription(db,tenantId);
  const sub = serializeSubscription(s);
  const access = subscriptionAccess(sub);
  const tenant = await db.query('SELECT is_active FROM internal.tenants WHERE id=$1',[tenantId]);
  if (!tenant.rows[0]?.is_active) Object.assign(access,{accessMode:'RESTRICTED',status:'EXPIRED'});
  const invoices = await db.query('SELECT * FROM billing.invoices WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',[tenantId]);
  const trialDay = Math.max(1,Math.floor((Date.now()-Date.parse(s.trial_started_at || s.created_at))/DAY_MS)+1);
  return { ok:true,subscription:{...sub,status:access.status,accessMode:access.accessMode},plan:sub.plan,
    ...access,trialDay,lifecycleStage:lifecycleStage(trialDay),trialDays:TRIAL_DAYS,
    outlets:{used:await outletUsage(db,tenantId),included:sub.plan?.maxOutlets ?? 2,extra:Number(s.extra_outlets),limit:(sub.plan?.maxOutlets ?? 2)+Number(s.extra_outlets)},
    invoices:invoices.rows.map(serializeInvoice) };
}
export async function createQuote(db: Db, tenantId: string, input: any) {
  const s = await ensureSubscription(db,tenantId);
  try { return billingQuote(s,input,await outletUsage(db,tenantId)); }
  catch (err) { throw new BillingError(400,(err as Error).message); }
}

export interface PaymentNotice { eventKey:string; invoiceNumber:string; reference:string; amount:number; currency:string; success:boolean; payload?:any }
export async function reconcilePayment(db: Db, notice: PaymentNotice) {
  if (!notice.eventKey || !notice.invoiceNumber || !notice.reference || !Number.isFinite(notice.amount)) throw new BillingError(400,'INVALID_PAYMENT_NOTICE');
  return db.tx(async c => {
    // Lock subscription via tenant BEFORE invoice: same order as admin/outlet
    // operations, and serialize different invoices for the same subscription.
    const lookup = await c.query('SELECT tenant_id FROM billing.invoices WHERE invoice_number=$1',[notice.invoiceNumber]);
    if (lookup.rows[0]) await c.query('SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE',[lookup.rows[0].tenant_id]);
    const found = await c.query('SELECT * FROM billing.invoices WHERE invoice_number=$1 FOR UPDATE',[notice.invoiceNumber]);
    const inv=found.rows[0];
    let outcome='REVIEW',reason='INVOICE_NOT_FOUND';
    let sub:any;
    if (inv) {
      sub=(await c.query('SELECT * FROM billing.subscriptions WHERE id=$1 FOR UPDATE',[inv.subscription_id])).rows[0];
      if (inv.payment_status==='PAID' && inv.reconciliation_status==='APPLIED') { outcome='DUPLICATE';reason='ALREADY_APPLIED'; }
      else if (Number(inv.amount)!==notice.amount || inv.currency!==notice.currency) reason='AMOUNT_OR_CURRENCY_MISMATCH';
      else if (!notice.success) { outcome='FAILED';reason='GATEWAY_NOT_SUCCESS'; }
      else if (!inv.quote) reason='LEGACY_INVOICE_NEEDS_REVIEW';
      else if (inv.quote.revision!==Number(sub.revision)) reason='STALE_SUBSCRIPTION_REVISION';
      else if (await outletUsage(c,inv.tenant_id)>inv.quote.maxOutlets) reason='OUTLET_LIMIT_BELOW_USAGE';
      else {outcome='APPLIED';reason='VERIFIED';}
    }
    const event=await c.query(`INSERT INTO billing.payment_events(event_key,invoice_number,gateway_reference,amount,currency,outcome,reason,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(event_key) DO NOTHING RETURNING id`,
      [notice.eventKey,notice.invoiceNumber,notice.reference,notice.amount,notice.currency,outcome,reason,JSON.stringify(notice.payload ?? {})]);
    if (!event.rowCount) return {ok:true,outcome:'DUPLICATE'};
    if (outcome==='APPLIED') {
      const q=inv.quote;
      await c.query(`UPDATE billing.subscriptions SET plan_id=$2,billing_cycle=$3,extra_outlets=$4,recurring_amount=$5,
        status='ACTIVE',current_period_start=$6,current_period_end=$7,grace_period_end=$7::timestamptz+interval '14 days',
        revision=revision+1,cancel_at_period_end=false,canceled_at=NULL,updated_at=now() WHERE id=$1`,
        [sub.id,q.planId,q.billingCycle,q.extraOutlets,q.recurringAmount,q.periodStart,q.periodEnd]);
      await c.query(`UPDATE billing.invoices SET payment_status='PAID',paid_at=now(),payment_gateway_ref=$2,
        reconciliation_status='APPLIED',reconciliation_note=$3 WHERE id=$1`,[inv.id,notice.reference,reason]);
    } else if (inv && outcome!=='DUPLICATE') {
      // A mismatch never grants access or invents a refund. Keep it visible in
      // reconciliation for an operator to investigate against gateway evidence.
      await c.query(`UPDATE billing.invoices SET reconciliation_status=$2,reconciliation_note=$3 WHERE id=$1`,[inv.id,outcome,reason]);
    }
    return {ok:true,outcome,reason};
  });
}

export async function assertTenantWritable(db: Pick<Db,'query'>,tenantId:string) {
  const {rows}=await db.query(`SELECT t.is_active,t.created_at,s.status,s.current_period_end,s.grace_period_end
    FROM internal.tenants t LEFT JOIN contract.subscription_operations s ON s.tenant_id=t.id WHERE t.id=$1`,[tenantId]);
  const s=rows[0];
  if (!s) throw new BillingError(403,'TENANT_NOT_FOUND');
  const end=s.current_period_end || new Date(Date.parse(s.created_at)+45*DAY_MS).toISOString();
  const access=subscriptionAccess({status:s.status || 'TRIAL',currentPeriodEnd:new Date(end).toISOString(),gracePeriodEnd:s.grace_period_end ? new Date(s.grace_period_end).toISOString():undefined});
  if (!s.is_active || access.accessMode!=='FULL') throw new BillingError(403,'SUBSCRIPTION_READ_ONLY');
}

export async function assertOutletCapacity(db:Db,tenantId:string,excludeId?:string) {
  await db.query('SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE',[tenantId]);
  await assertTenantWritable(db,tenantId);
  const {rows}=await db.query('SELECT plan_id,extra_outlets FROM contract.subscription_operations WHERE tenant_id=$1',[tenantId]);
  const limit=(findSaaSPlan(rows[0]?.plan_id)?.maxOutlets ?? 2)+Number(rows[0]?.extra_outlets || 0);
  const used=await db.query('SELECT count(*)::int AS count FROM internal.outlets WHERE tenant_id=$1 AND is_active AND ($2::uuid IS NULL OR id<>$2)',[tenantId,excludeId || null]);
  if(Number(used.rows[0].count)>=limit) throw new BillingError(409,'OUTLET_LIMIT_REACHED');
}
