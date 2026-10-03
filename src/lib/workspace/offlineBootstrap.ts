import type {SaaSSubscription} from '../../types';
import {readBusinessDirectory,type Directory} from './businessDirectory';
import {subscriptionAccess} from '../../config/subscriptionPolicy';
import {findSaaSPlan} from '../../config/saasPlans';

const key=(owner:string)=>'newhope_verified_workspace_v1_'+owner;
const DAY=24*60*60*1000;
type Snapshot={version:1;owner:string;verifiedAt:number;expiresAt:number;directory:Directory;subscription:SaaSSubscription};
/** Device cache for offline UI/queueing ONLY, never a server authorization or
 * ledger ACK. Online bootstrap never falls back to this cache after a 401/403.
 * The server revalidates tenant/business/outlet/plan on every replayed write. */
export function saveVerifiedBootstrap(owner:string,directory:Directory,subscription:SaaSSubscription,now=Date.now()){
  if(!directory.tenantId||directory.tenantId!==subscription.tenantId||subscriptionAccess(subscription,now).accessMode!=='FULL'||subscription.isActive===false)return;
  // A cached trial/paid period cannot silently extend across its end, even if
  // the server would later offer Free/grace. It must verify that transition.
  const periodEnd=Date.parse(subscription.currentPeriodEnd);
  const expiresAt=Math.min(now+DAY,periodEnd);
  if(!Number.isFinite(expiresAt)||expiresAt<=now)return;
  const value:Snapshot={version:1,owner,verifiedAt:now,expiresAt,directory,subscription};
  localStorage.setItem(key(owner),JSON.stringify(value));
}
export function readOfflineBootstrap(owner:string,now=Date.now()):Snapshot|null{
  try{
    const raw=localStorage.getItem(key(owner));if(!raw)return null;
    const row=JSON.parse(raw) as Snapshot;
    if(row.version!==1||row.owner!==owner||!Number.isFinite(row.verifiedAt)||!Number.isFinite(row.expiresAt)||
      row.verifiedAt>now||row.expiresAt<=now||row.expiresAt>row.verifiedAt+DAY)return null;
    const directory=readBusinessDirectory({...row.directory,ok:true});
    if(!directory.tenantId||directory.tenantId!==row.subscription?.tenantId||!findSaaSPlan(row.subscription.planId)||
      !['ACTIVE','TRIAL','TRIALING','FREE'].includes(row.subscription.status)||row.subscription.isActive===false||
      subscriptionAccess(row.subscription,now).accessMode!=='FULL'||Date.parse(row.subscription.currentPeriodEnd)<row.expiresAt)return null;
    return {...row,directory};
  }catch{return null;}
}
const financialKey=(owner:string,businessId:string,outletId:string)=>`newhope_verified_finance_v1_${owner}_${businessId}_${outletId}`;
export function saveVerifiedFinancialScope(owner:string,businessId:string,outletId:string,now=Date.now()){
  localStorage.setItem(financialKey(owner,businessId,outletId),JSON.stringify({owner,businessId,outletId,verifiedAt:now}));
}
export function hasVerifiedFinancialScope(owner:string,businessId:string,outletId:string,expiresAt:number,now=Date.now()){
  try{
    const row=JSON.parse(localStorage.getItem(financialKey(owner,businessId,outletId))||'null');
    return !!row&&row.owner===owner&&row.businessId===businessId&&row.outletId===outletId&&Number.isFinite(row.verifiedAt)&&
      row.verifiedAt<=now&&now-row.verifiedAt<DAY&&now<expiresAt;
  }catch{return false;}
}
