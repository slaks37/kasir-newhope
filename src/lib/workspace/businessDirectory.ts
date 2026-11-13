import {useEffect,useState} from 'react';
import {coalescedRead,refreshCoordinator} from '../sync/refreshCoordinator';
import type {SaaSSubscription} from '../../types';
import type {BusinessIdentity} from './businessIdentity';
import {readOfflineBootstrap} from './offlineBootstrap';

export type Directory={tenantId:string|null;businesses:BusinessIdentity[];workspaceAuth?:boolean;subscription?:SaaSSubscription|null;tenants?:Array<{tenantId:string;name:string}>;capabilities?:{multiBusiness:boolean};canSetUpBusiness?:boolean};
const sectors=new Set(['FNB','RETAIL','LAUNDRY','BARBERSHOP','CARWASH']);
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
/** Reject incomplete/mixed-tenant snapshots instead of guessing their parent. */
export function readBusinessDirectory(data:unknown):Directory{
  const value=data as Directory&{ok?:boolean};
  if(!value?.ok||!Array.isArray(value.businesses)||!(value.tenantId===null||uuid(value.tenantId))||value.tenantId===null&&value.businesses.length)throw Error('BUSINESS_DIRECTORY_INVALID');
  const businessIds=new Set<string>(),outletIds=new Set<string>();
  for(const business of value.businesses){
    if(!business||!uuid(business.businessId)||businessIds.has(business.businessId)||business.tenantId!==value.tenantId||
      typeof business.name!=='string'||!sectors.has(business.sector)||!['ACTIVE','INACTIVE'].includes(business.status)||
      !(business.legacyAlias===null||typeof business.legacyAlias==='string')||!Array.isArray(business.outlets))throw Error('BUSINESS_DIRECTORY_INVALID');
    if(business.transportRef!==undefined&&business.transportRef!==null&&(typeof business.transportRef!=='string'||!business.transportRef||business.transportRef.length>96))throw Error('BUSINESS_DIRECTORY_INVALID');
    if(business.legacyAlias&&business.transportRef!==undefined&&business.transportRef!==business.legacyAlias)throw Error('BUSINESS_DIRECTORY_INVALID');
    businessIds.add(business.businessId);
    for(const outlet of business.outlets){
      if(!outlet||!uuid(outlet.outletId)||outletIds.has(outlet.outletId)||outlet.businessId!==business.businessId||typeof outlet.name!=='string'||
        typeof outlet.address!=='string'||!['ACTIVE','INACTIVE'].includes(outlet.status))throw Error('BUSINESS_DIRECTORY_INVALID');
      for(const field of ['latitude','longitude','radiusMeters'] as const)if(outlet[field]!=null&&!Number.isFinite(outlet[field]))throw Error('BUSINESS_DIRECTORY_INVALID');
      outletIds.add(outlet.outletId);
    }
  }
  return {tenantId:value.tenantId,businesses:value.businesses,capabilities:value.capabilities,...(value.workspaceAuth?{workspaceAuth:true,subscription:value.subscription,tenants:value.tenants,canSetUpBusiness:value.canSetUpBusiness===true}: {})};
}

export function workspaceOnboarding(directory:Directory|null, verified:boolean, online:boolean, failed:boolean){
  if(!directory?.workspaceAuth||!verified||!online||failed)return null;
  if(!directory.tenantId)return directory.tenants?.length?'select-tenant':directory.canSetUpBusiness?'create-business':'wait-for-access';
  if(!directory.subscription&&directory.canSetUpBusiness)return directory.businesses.some(b=>b.status==='ACTIVE')?'initialize-trial':directory.businesses.length?null:'create-business';
  return null;
}

export async function initializeWorkspaceTrial(tenantId:string){
  const response=await fetch('/api/v1/subscription/start-trial',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({intent:'initialize',tenantId})});
  const result=await response.json();
  if(!response.ok||!result.ok||result.subscription?.tenantId!==tenantId)throw Error('WORKSPACE_TRIAL_UNAVAILABLE');
}
export async function fetchBusinessDirectory(owner:string,signal?:AbortSignal):Promise<Directory>{
  return coalescedRead('business-directory:'+owner,async()=>{
    const tenant=localStorage.getItem('newhope_directory_tenant_'+owner);const query=import.meta.env.VITE_MODULE_WORKSPACES==='1'?'?workspace=2'+(tenant?'&tenantId='+encodeURIComponent(tenant):''):'';
    const response=await fetch('/api/v1/sync/business'+query,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(response.status===401||response.status===403)throw Error('WORKSPACE_ACCESS_REVOKED');
    if(!response.ok)throw Error('BUSINESS_DIRECTORY_UNAVAILABLE');
    return readBusinessDirectory(await response.json());
  },signal);
}
export function useBusinessDirectory(owner:string){
  const [state,setState]=useState<{owner:string;directory:Directory|null;error:string|null;verified:boolean;offlineExpiresAt?:number}>(()=>{
    const cached=!navigator.onLine?readOfflineBootstrap(owner):null;
    return {owner,directory:cached?.directory||null,error:null,verified:false,offlineExpiresAt:cached?.expiresAt};
  });
  useEffect(()=>{
    const controller=new AbortController();
    const refresh=async()=>{try{
      const directory=await fetchBusinessDirectory(owner,controller.signal);
      if(!controller.signal.aborted)setState(previous=>previous.owner===owner&&previous.verified&&!previous.error&&JSON.stringify(previous.directory)===JSON.stringify(directory)?previous:{owner,directory,error:null,verified:true});
    }catch(error){if(!controller.signal.aborted)setState(previous=>({...previous,owner,directory:previous.owner===owner?previous.directory:null,error:error instanceof Error?error.message:'BUSINESS_DIRECTORY_UNAVAILABLE'}));}};
    const unsubscribe=refreshCoordinator.register('business-directory:'+owner,{run:refresh,interval:120000,events:['outlets-updated','subscription-updated']});
    return()=>{controller.abort();unsubscribe();};
  },[owner]);
  return state.owner===owner?state:{owner,directory:null,error:null,verified:false};
}
