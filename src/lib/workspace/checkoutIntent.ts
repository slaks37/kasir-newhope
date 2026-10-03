import {PAID_SAAS_PLANS,TRIAL_PLAN_ID} from '../../config/saasPlans';
import type {SaaSSubscription} from '../../types';

type CheckoutIntent={owner:string|null;plan:string;cycle:'MONTHLY'|'YEARLY';expiresAt:number};
const intentKey=(owner?:string)=>'nhpos_checkout_intent_v2_'+(owner||'guest');
/** Form preference only. Never determines entitlement or forces a redirect. */
export function readCheckoutIntent(owner?:string):CheckoutIntent|null{
  try{
    const value=JSON.parse(sessionStorage.getItem(intentKey(owner))||'null');
    return value&&value.owner===(owner||null)&&PAID_SAAS_PLANS.some(plan=>plan.id===value.plan)&&
      ['MONTHLY','YEARLY'].includes(value.cycle)&&Number.isFinite(value.expiresAt)&&value.expiresAt>Date.now()?value:null;
  }catch{return null;}
}
export function saveCheckoutIntent(owner:string|undefined,plan:string,cycle:'MONTHLY'|'YEARLY'){
  sessionStorage.setItem(intentKey(owner),JSON.stringify({owner:owner||null,plan,cycle,expiresAt:Date.now()+30*60*1000}));
}
export function claimCheckoutIntent(owner:string){
  const guest=readCheckoutIntent();
  if(guest){sessionStorage.setItem(intentKey(owner),JSON.stringify({...guest,owner}));sessionStorage.removeItem(intentKey());}
}
export function clearCheckoutIntent(owner?:string){sessionStorage.removeItem(intentKey(owner));}

/** Explicit capacity purchases must win over stale onboarding/trial hints.
 * This selects a quote only; the billing server still validates and charges it.
 */
export function checkoutDefaults(intent:string|null,subscription:SaaSSubscription|undefined,hasUsedTrial:boolean,pendingPlan:string|null,pendingCycle:string|null){
  const paid=(id:string|undefined)=>PAID_SAAS_PLANS.some(plan=>plan.id===id);
  const capacityIntent=intent==='add-outlet'||intent==='upgrade';
  const planId=intent==='upgrade'?'plan-pro-monthly':intent==='add-outlet'
    ?paid(subscription?.planId)?subscription!.planId:'plan-plus-monthly'
    :pendingPlan&&(paid(pendingPlan)||pendingPlan===TRIAL_PLAN_ID&&!hasUsedTrial)?pendingPlan
    :hasUsedTrial?'plan-plus-monthly':TRIAL_PLAN_ID;
  const cycle=capacityIntent?subscription?.billingCycle:pendingCycle||subscription?.billingCycle;
  return {planId,yearly:cycle?cycle==='YEARLY':true,
    extraOutlets:(subscription?.extraOutlets||0)+(intent==='add-outlet'?1:0),
    onboarding:!capacityIntent&&Boolean(pendingPlan)};
}
