import React,{createContext,useContext,useEffect,useState,useRef,useCallback} from 'react';
import {useAuth} from './AuthContext';
import {useBusinessDirectory,type Directory} from '../lib/workspace/businessDirectory';
import {selectionKey,verifiedSelection,type BusinessSelection} from '../lib/workspace/selection';
import type {BusinessIdentity} from '../lib/workspace/businessIdentity';
import type {BusinessSector} from '../types';
import type {SaaSSubscription} from '../types';
import {refreshCoordinator,coalescedRead} from '../lib/sync/refreshCoordinator';
import {isFreePlan} from '../config/freePlanPolicy';
import {readOfflineBootstrap,saveVerifiedBootstrap} from '../lib/workspace/offlineBootstrap';
import {useOnline} from '../lib/workspace/useOnline';

type WorkspaceBusiness={business:BusinessIdentity;directory:Directory;subscription:SaaSSubscription;outletId?:string;offlineExpiresAt?:number;select:(businessId:string,outletId?:string)=>void;registerSwitchGuard:(guard:()=>void)=>()=>void};
const Context=createContext<WorkspaceBusiness|null>(null);
export function useWorkspaceBusiness(){const value=useContext(Context);if(!value)throw Error('WORKSPACE_IDENTITY_REQUIRED');return value;}

/** Identity bootstrap mounts no operational/financial stores until membership
 * is verified. Remounting a selected namespace cancels outgoing hydration. */
export function WorkspaceBusinessProvider({children}:{children:React.ReactNode}){
  const {user}=useAuth();const owner=user!.id;
  const networkOnline=useOnline();
  const {directory,error,verified:directoryVerified,offlineExpiresAt:directoryOfflineExpiry}=useBusinessDirectory(owner);
  const [offlineBootstrap]=useState(()=>!navigator.onLine?readOfflineBootstrap(owner):null);
  const switchGuards=useRef(new Set<()=>void>());
  const registerSwitchGuard=useCallback((guard:()=>void)=>{switchGuards.current.add(guard);return()=>{switchGuards.current.delete(guard);};},[]);
  const [subscription,setSubscription]=useState<SaaSSubscription|null>(offlineBootstrap?.subscription||null),[accountError,setAccountError]=useState('');
  const [subscriptionVerified,setSubscriptionVerified]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    const run=async()=>{try{
      const data=await coalescedRead('subscription:'+owner,async()=>{const response=await fetch('/api/v1/subscription/status',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(response.status===401||response.status===403)throw Error('WORKSPACE_ACCESS_REVOKED');const result=await response.json();if(!response.ok||!result.ok||!result.subscription)throw Error('SUBSCRIPTION_UNAVAILABLE');return result;},controller.signal);
      if(!controller.signal.aborted){setSubscription(previous=>JSON.stringify(previous)===JSON.stringify(data.subscription)?previous:data.subscription);setSubscriptionVerified(true);setAccountError('');}
    }catch(error){if(!controller.signal.aborted)setAccountError(error instanceof Error?error.message:'SUBSCRIPTION_UNAVAILABLE');}};
    const unsubscribe=refreshCoordinator.register('subscription:'+owner,{run,interval:120000,events:['subscription-updated']});
    return()=>{controller.abort();unsubscribe();};
  },[owner]);
  useEffect(()=>{
    if(directoryVerified&&subscriptionVerified&&directory&&subscription&&!error&&!accountError){
      try{saveVerifiedBootstrap(owner,directory,subscription);}catch{console.warn('[workspace] Offline metadata cache unavailable; cloud data unchanged');}
    }
  },[owner,directoryVerified,subscriptionVerified,directory,subscription,error,accountError]);
  const offlineExpiresAt=React.useMemo(()=>!networkOnline?readOfflineBootstrap(owner)?.expiresAt:
    !directoryVerified||!subscriptionVerified?Math.min(directoryOfflineExpiry||0,offlineBootstrap?.expiresAt||0)||undefined:undefined,
    [networkOnline,owner,directoryVerified,subscriptionVerified,directoryOfflineExpiry,offlineBootstrap]);
  const [hint,setHint]=useState<BusinessSelection|null>(()=>{try{return JSON.parse(localStorage.getItem(selectionKey(owner))||'null');}catch{return null;}});
  const [name,setName]=useState(user?.user_metadata?.store_name||'Toko Saya');
  const [sector,setSector]=useState<BusinessSector>(user?.user_metadata?.business_sector||'FNB');
  const [busy,setBusy]=useState(false),[setupError,setSetupError]=useState('');
  let legacy:{businessSector?:string;activeBranchId?:string}={};
  try{legacy=JSON.parse(localStorage.getItem('newhope_user_'+owner+'_settings')||'{}');}catch{}
  let selected=directory?.tenantId?verifiedSelection(owner,directory.tenantId,directory.businesses.filter(b=>b.legacyAlias||directory.capabilities?.multiBusiness),hint,
    {sector:legacy.businessSector||sector,outletId:legacy.activeBranchId}):null;
  const free=isFreePlan(subscription||undefined);
  if(free&&subscription?.freeSelection&&directory?.tenantId){
    const choice=directory.businesses.find(b=>b.status==='ACTIVE'&&b.outlets.some(o=>o.outletId===subscription.freeSelection!.branchId&&o.status==='ACTIVE'));
    selected=choice?{businessId:choice.businessId,outletId:subscription.freeSelection.branchId}:null;
  }
  const business=directory?.businesses.find(b=>b.businessId===selected?.businessId);
  const select=(businessId:string,outletId?:string)=>{
    const target=directory?.businesses.find(b=>b.businessId===businessId&&b.status==='ACTIVE'&&b.transportRef&&(b.legacyAlias||directory.capabilities?.multiBusiness));
    if(!target||outletId&&!target.outlets.some(o=>o.outletId===outletId&&o.status==='ACTIVE'))throw Error('BUSINESS_SELECTION_NOT_OWNED');
    if((free&&subscription?.freeSelection&&!target.outlets.some(o=>o.outletId===subscription.freeSelection!.branchId))||(free&&outletId&&outletId!==subscription?.freeSelection?.branchId))throw Error('FREE_BRANCH_LOCKED');
    const next={businessId,outletId};
    // Storage failure must not silently lose an outgoing draft/selection.
    for(const guard of switchGuards.current)guard();
    localStorage.setItem(selectionKey(owner),JSON.stringify(next));setHint(next);
  };
  useEffect(()=>{if(selected)try{localStorage.setItem(selectionKey(owner),JSON.stringify(selected));}catch{setSetupError('Pilihan perangkat belum dapat disimpan. Data bisnis tetap tersimpan.');}},[owner,selected?.businessId,selected?.outletId]);
  const provision=async()=>{setBusy(true);setSetupError('');try{
    const response=await fetch('/api/v1/sync/business',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sector,storeName:name})});
    const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'BUSINESS_SETUP_FAILED');
    setHint({businessId:data.merchantId});window.dispatchEvent(new Event('outlets-updated'));
  }catch(error){setSetupError(error instanceof Error?error.message:'BUSINESS_SETUP_FAILED');}finally{setBusy(false);}};
  if(error==='WORKSPACE_ACCESS_REVOKED'||accountError==='WORKSPACE_ACCESS_REVOKED')return <main className="min-h-screen bg-slate-50 p-8"><p role="alert">Akses bisnis perlu diverifikasi kembali. Cache dan antrean tetap disimpan; data tidak dikirim sampai akses diizinkan server.</p></main>;
  if(!directory||!subscription)return <main className="min-h-screen bg-slate-50 p-8"><p role={error||accountError?'alert':'status'}>{error||accountError?'Cloud belum dapat dihubungi. Sistem mencoba kembali otomatis; data perangkat tetap tersimpan.':'Memverifikasi bisnis dan paket di cloud…'}</p></main>;
  if(!business||!selected)return <main className="min-h-screen bg-slate-50 p-8"><section className="mx-auto max-w-lg rounded-2xl border bg-white p-6 space-y-4"><h1 className="text-xl font-bold">Pilih bisnis</h1>
    {directory.businesses.filter(b=>b.status==='ACTIVE'&&b.transportRef).map(b=><button key={b.businessId} disabled={!b.legacyAlias&&!directory.capabilities?.multiBusiness} className="block w-full rounded-xl border p-4 text-left disabled:opacity-50" onClick={()=>{try{select(b.businessId);}catch{setSetupError('Pilihan belum dapat disimpan. Coba kembali setelah penyimpanan perangkat tersedia.');}}}>{b.name} · {b.sector}{!b.legacyAlias&&!directory.capabilities?.multiBusiness?' · menunggu migrasi server':''}</button>)}
    {!directory.businesses.length&&<form onSubmit={e=>{e.preventDefault();void provision();}} className="space-y-3"><label className="block">Nama bisnis<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} className="block w-full rounded border p-2"/></label><label className="block">Jenis bisnis<select value={sector} onChange={e=>setSector(e.target.value as BusinessSector)} className="block w-full rounded border p-2">{['FNB','RETAIL','LAUNDRY','BARBERSHOP','CARWASH'].map(s=><option key={s}>{s}</option>)}</select></label><button disabled={busy} className="rounded-lg bg-amber-400 p-3">{busy?'Menyiapkan…':'Siapkan bisnis'}</button></form>}
    {directory.businesses.length>0&&!directory.businesses.some(b=>b.status==='ACTIVE'&&b.transportRef)&&<p>Bisnis belum memiliki identitas aktif yang dapat dipakai. Hubungi administrator; data tidak dipindahkan otomatis.</p>}
    {setupError&&<p role="alert">{setupError}</p>}</section></main>;
  if(!selected.outletId&&business.outlets.filter(o=>o.status==='ACTIVE').length>1)return <main className="min-h-screen bg-slate-50 p-8"><section className="mx-auto max-w-lg rounded-2xl border bg-white p-6 space-y-4"><h1 className="text-xl font-bold">Pilih outlet · {business.name}</h1>{business.outlets.filter(o=>o.status==='ACTIVE').map(o=><button key={o.outletId} onClick={()=>select(business.businessId,o.outletId)} className="block w-full rounded-xl border p-4 text-left">{o.name} · {o.address}</button>)}</section></main>;
  return <Context.Provider value={{business,directory,subscription,outletId:selected.outletId,offlineExpiresAt,select,registerSwitchGuard}}>{children}</Context.Provider>;
}
