import React,{useEffect,useState} from 'react';
import {usePOSFields} from '../../context/POSDomains';
import {useTenant} from '../../context/TenantContext';
import {isFreePlan} from '../../config/freePlanPolicy';
import {formatRupiah as rp} from '../../utils/formatters';
import type {BusinessBrain} from '../../lib/assistant/businessBrain';
import {refreshCoordinator} from '../../lib/sync/refreshCoordinator';

type Brief={businessId:string;generatedAt:string;sales:BusinessBrain['sales'];insights:Array<{id:string;title:string}>};
export function BusinessBrief(){
  const {setActiveTab,settings}=usePOSFields(["setActiveTab","settings"]);const tenant=useTenant();
  const enabled=!isFreePlan(settings.subscription)&&['ADMIN','MANAGER'].includes(tenant.userRole);
  const [state,setState]=useState<{businessId:string;brief:Brief|null;error:string|null}>({businessId:tenant.businessId,brief:null,error:null});
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();let running=false;
    setState({businessId:tenant.businessId,brief:null,error:null});
    const refresh=async()=>{
      if(running||controller.signal.aborted)return;running=true;
      try{
        const response=await fetch('/api/v1/assistant/daily-brief?businessId='+encodeURIComponent(tenant.businessId),{cache:'no-store',signal:controller.signal});
        const data=await response.json();
        if(!response.ok||!data.ok||data.brief?.businessId!==tenant.businessId)throw new Error('BRIEF_UNAVAILABLE');
        if(!controller.signal.aborted)setState({businessId:tenant.businessId,brief:data.brief,error:null});
      }catch{if(!controller.signal.aborted)setState({businessId:tenant.businessId,brief:null,error:'Ringkasan cloud belum tersedia. Angka perangkat tidak dipakai sebagai pengganti.'});}
      finally{running=false;}
    };
    const unsubscribe=refreshCoordinator.register('brief:'+tenant.businessId,{run:refresh,interval:120000,events:['financial-updated']});
    return()=>{controller.abort();unsubscribe();};
  },[tenant.businessId,enabled]);
  if(!enabled)return null;
  const brief=state.businessId===tenant.businessId?state.brief:null;
  const sales=brief?.sales;
  return <section aria-label="Business Daily Brief cloud" className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 text-slate-800">
    <div className="flex flex-wrap justify-between gap-2"><div><p className="text-xs font-bold tracking-wide text-amber-700">NEW HOPE INTELLIGENCE · TANPA TOKEN</p><h3 className="mt-1 text-xl font-extrabold">Business Daily Brief</h3></div><span className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs">Data cloud · WIB</span></div>
    <p className="mt-1 text-xs text-slate-500">{settings.storeName} · gabungan outlet dalam unit usaha ini · transaksi terkonfirmasi server</p>
    {sales?<><div className="my-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{[
      ['Omzet kemarin',rp(sales.revenue)],['Transaksi',String(sales.orders)],
      ['Vs hari sejenis',sales.revenueChangePct===null?'Belum cukup data':sales.revenueChangePct+'%'],
      ['Skenario akhir bulan',sales.projectedMonthEnd===null?'Butuh ≥7 hari lengkap':rp(sales.projectedMonthEnd)],
    ].map(([label,value])=><div key={label}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>)}</div>
    <p className="text-xs text-slate-500">{sales.date} · diperbarui {new Date(brief!.generatedAt).toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit'})} WIB</p></>:
    <p role="status" className="my-4 text-sm text-slate-600">{state.error||'Memuat ringkasan dari cloud…'}</p>}
    <button className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900" onClick={()=>setActiveTab('ai')}>Buka analisis & rencana tindakan</button>
  </section>;
}
