import {DAY_MS,findSaaSPlan,TRIAL_DAYS,TRIAL_PLAN_ID} from './saasPlans';
import {FREE_PLAN_ID} from './freePlanPolicy';
import {subscriptionAccess} from './subscriptionPolicy';

/** Read-only billing projection shared by admin directory, support and detail.
 * Never initializes a trial or changes the persisted subscription. */
export function accountSubscription(tenant:{created_at:Date|string;is_active:boolean},stored:any,used:number,now=Date.now()) {
  const start=new Date(tenant.created_at).toISOString();
  const end=new Date(Date.parse(start)+TRIAL_DAYS*DAY_MS).toISOString();
  const s=stored||{plan_id:TRIAL_PLAN_ID,status:'TRIAL',current_period_start:start,current_period_end:end,
    grace_period_end:new Date(Date.parse(end)+14*DAY_MS).toISOString(),trial_started_at:start,trial_ends_at:end,extra_outlets:0};
  const access=subscriptionAccess({status:tenant.is_active?s.status:'EXPIRED',planId:tenant.is_active?s.plan_id:undefined,
    currentPeriodEnd:new Date(s.current_period_end).toISOString(),gracePeriodEnd:s.grace_period_end?new Date(s.grace_period_end).toISOString():undefined},now);
  const planId=access.status==='FREE'?FREE_PLAN_ID:s.plan_id;
  const plan=findSaaSPlan(planId);
  const included=plan?.maxOutlets??null,extra=access.status==='FREE'?0:Number(s.extra_outlets||0);
  const max=included===null?null:included+extra;
  // Free retains other branch rows but licenses only the owner's selection,
  // exactly as the existing merchant billing endpoint does.
  const licensedUsed=access.status==='FREE'?(s.free_selection?1:0):Number(used);
  return {subscription:{planId,planName:plan?.name||planId,billingCycle:s.billing_cycle||null,
    periodStart:s.current_period_start,periodEnd:s.current_period_end,graceEnd:s.grace_period_end,
    trialStart:s.trial_started_at,trialEnd:s.trial_ends_at,recurringAmount:s.recurring_amount??null,...access},
    retainedOutlets:Number(used),capacity:{included,extra,used:licensedUsed,max,remaining:max===null?null:Math.max(0,max-licensedUsed)}};
}
