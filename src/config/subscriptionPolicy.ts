import { addBillingPeriod, DAY_MS, findSaaSPlan, TRIAL_PLAN_ID } from './saasPlans';

export type BillingCycle = 'MONTHLY' | 'YEARLY';
export type AccessMode = 'FULL' | 'READ_ONLY' | 'RESTRICTED';
export function subscriptionAccess(sub: { status: string; currentPeriodEnd: string; gracePeriodEnd?: string }, now = Date.now()) {
  const end = Date.parse(sub.currentPeriodEnd);
  const grace = sub.gracePeriodEnd ? Date.parse(sub.gracePeriodEnd) : end + 14 * DAY_MS;
  const terminal = ['EXPIRED', 'CANCELED', 'CANCELLED', 'SUSPENDED'].includes(sub.status);
  const accessMode: AccessMode = terminal || !Number.isFinite(end) || now >= grace ? 'RESTRICTED' : now >= end ? 'READ_ONLY' : 'FULL';
  return { accessMode, status: accessMode === 'RESTRICTED' ? 'EXPIRED' : accessMode === 'READ_ONLY' ? 'PAST_DUE' : sub.status === 'TRIALING' ? 'TRIAL' : sub.status,
    daysLeft: Math.max(0, Math.ceil((end - now) / DAY_MS)), graceDaysLeft: Math.max(0, Math.ceil((grace - Math.max(now, end)) / DAY_MS)) };
}

export function lifecycleStage(day: number) {
  if (day <= 3) return 'ACTIVATION';
  if (day <= 10) return 'DAILY_OPERATIONS';
  if (day <= 21) return 'WORKFLOW';
  if (day <= 35) return 'OWNER_INSIGHTS';
  if (day <= 42) return 'CONVERSION';
  if (day <= 45) return 'FINAL_REMINDER';
  if (day <= 59) return 'READ_ONLY';
  return 'EXPIRED';
}

export function billingQuote(sub: any, input: any, outletCount: number, now = new Date()) {
  const plan = findSaaSPlan(input.planId || input.targetPlanId);
  if (!plan || plan.id === TRIAL_PLAN_ID) throw new Error('INVALID_PAID_PLAN');
  const cycle: BillingCycle = input.billingCycle ?? sub.billing_cycle ?? 'MONTHLY';
  if (!['MONTHLY', 'YEARLY'].includes(cycle)) throw new Error('INVALID_BILLING_CYCLE');
  const extras = Number(input.extraOutlets ?? sub.extra_outlets ?? 0);
  if (!Number.isInteger(extras) || extras < 0 || extras > 100) throw new Error('INVALID_EXTRA_OUTLETS');
  if (outletCount > plan.maxOutlets + extras) throw new Error('OUTLET_LIMIT_BELOW_USAGE');
  const recurringAmount = cycle === 'YEARLY'
    ? ((plan.priceYearlyIdr ?? plan.priceIdr) + extras * (plan.extraOutletYearlyIdr ?? 0)) * 12
    : plan.priceIdr + extras * (plan.extraOutletPriceIdr ?? 0);
  const active = sub.status === 'ACTIVE' && Date.parse(sub.current_period_end) > now.getTime();
  const same = sub.plan_id === plan.id && sub.billing_cycle === cycle && Number(sub.extra_outlets) === extras;
  const oldEnd = new Date(sub.current_period_end);
  // Renewal preserves paid time. Changes start a new period, crediting the
  // remaining fraction of the amount actually contracted, never list price.
  const start = active && same ? oldEnd : now;
  const fraction = active && !same ? Math.max(0, Math.min(1, (oldEnd.getTime() - now.getTime()) /
    (oldEnd.getTime() - Date.parse(sub.current_period_start)))) : 0;
  const credit = Math.floor(Number(sub.recurring_amount || 0) * fraction);
  // No silent destruction of prepaid annual value on a monthly downgrade.
  if (credit > recurringAmount) throw new Error('CHANGE_AT_RENEWAL_REQUIRED');
  return { planId: plan.id, planName: plan.name, billingCycle: cycle, extraOutlets: extras,
    recurringAmount, unusedCredit: credit, amount: recurringAmount - credit, currency: 'IDR',
    periodStart: start.toISOString(), periodEnd: addBillingPeriod(start, cycle).toISOString(),
    revision: Number(sub.revision || 0), maxOutlets: plan.maxOutlets + extras };
}
