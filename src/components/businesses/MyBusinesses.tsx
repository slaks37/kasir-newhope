import React,{useRef,useState} from 'react';
import {Building2,MapPin} from 'lucide-react';
import {usePOSFields} from '../../context/POSDomains';
import {useWorkspaceBusiness} from '../../context/WorkspaceBusinessContext';
import type {BusinessSector} from '../../types';
import {navigate} from '../../lib/navigation/workspaceRouter';
import {isFreePlan} from '../../config/freePlanPolicy';
import {businessAvailability,sectorLabel} from '../../lib/workspace/businessPresentation';

/** Canonical directory; selecting UUIDs remounts isolated durable namespaces. */
export function MyBusinesses(){
  const {settings}=usePOSFields(['settings']);
  const {directory,business:current,select}=useWorkspaceBusiness();
  const [form,setForm]=useState<'business'|'outlet'|null>(null),[name,setName]=useState('');
  const [sector,setSector]=useState<BusinessSector>('FNB'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const requestKey=useRef(crypto.randomUUID());
  const subscription=settings.subscription;
  const activeOutlets=directory?.businesses.flatMap(business=>business.outlets).filter(outlet=>outlet.status==='ACTIVE').length;
  const free=isFreePlan(subscription);
  const used=free?(subscription?.freeSelection?1:0):activeOutlets;
  const limit=subscription?.plan?subscription.plan.maxOutlets+(free?0:subscription.extraOutlets||0):null;
  const remaining=used!==undefined&&limit!==null?Math.max(0,limit-used):null;
  const openOutletForm=()=>{setForm('outlet');setName('');requestKey.current=crypto.randomUUID();};
  const submit=async()=>{setBusy(true);setError('');try{
    const response=await fetch(form==='business'?'/api/v1/sync/business':'/api/v1/subscription/outlets',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form==='business'?
        {intent:'create',requestKey:requestKey.current,sector,storeName:name}:
        {id:requestKey.current,businessId:current.businessId,businessSector:current.sector,name,isActive:true})});
    const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'BUSINESS_SAVE_FAILED');
    setForm(null);setName('');requestKey.current=crypto.randomUUID();window.dispatchEvent(new Event('outlets-updated'));
  }catch(error){setError(error instanceof Error?error.message:'BUSINESS_SAVE_FAILED');}finally{setBusy(false);}};
  const choose=(businessId:string,outletId?:string)=>{try{select(businessId,outletId);setError('');}catch(error){setError(error instanceof Error?error.message:'BUSINESS_SELECTION_FAILED');}};
  return <section className="flex-1 overflow-auto bg-slate-50 p-4 md:p-8">
    <div className="max-w-5xl mx-auto space-y-5">
      <div><h1 className="text-2xl font-bold text-slate-900">Bisnis & Outlet Saya</h1><p className="text-slate-500 mt-2">Satu akun dan satu paket untuk semua bisnis di bawah ini. Setiap bisnis punya katalog, denah, dan laporan terpisah. Outlet adalah cabang dari sebuah bisnis.</p>
      <div className="flex gap-3 mt-4"><button disabled={free||!directory.capabilities?.multiBusiness} onClick={()=>{setForm('business');setName('');requestKey.current=crypto.randomUUID();}} className="rounded-xl border bg-white px-4 py-2 disabled:opacity-50">Tambah bisnis</button>
      <button disabled={free} onClick={()=>{if(remaining===0)navigate('/subscription?intent=add-outlet');else openOutletForm();}} className="rounded-xl border bg-white px-4 py-2 disabled:opacity-50">Tambah outlet · {current.name}</button></div>
      {!free&&!directory.capabilities?.multiBusiness&&<p className="text-sm text-slate-500 mt-2">Penambahan bisnis baru belum diaktifkan di server. Bisnis terdaftar tetap dapat dikelola.</p>}
      {free&&<p className="text-sm text-slate-500 mt-2">Paket Free memakai satu outlet pilihan owner. Upgrade paket untuk membuka outlet atau bisnis lainnya.</p>}</div>
      {form&&<form onSubmit={event=>{event.preventDefault();void submit();}} className="rounded-2xl border bg-white p-5 space-y-3"><h2 className="font-bold">{form==='business'?'Bisnis baru':'Outlet baru · '+current.name}</h2>
        <label className="block">Nama<input required maxLength={100} value={name} disabled={busy} onChange={event=>{setName(event.target.value);requestKey.current=crypto.randomUUID();}} className="block rounded-lg border p-2 w-full"/></label>
        {form==='business'&&<label className="block">Jenis bisnis<select value={sector} disabled={busy} onChange={event=>{setSector(event.target.value as BusinessSector);requestKey.current=crypto.randomUUID();}} className="block rounded-lg border p-2">{['FNB','RETAIL','LAUNDRY','BARBERSHOP','CARWASH'].map(s=><option key={s}>{s}</option>)}</select></label>}
        <p className="text-sm text-slate-500">{form==='business'?'Bisnis dibuat terpisah, termasuk bila jenis usahanya sama. Outlet dapat dibuka setelahnya sesuai kapasitas akun.':'Pembukaan outlet memakai satu slot di seluruh akun.'}</p>
        <button disabled={busy} className="rounded-xl bg-amber-400 px-4 py-2">{busy?'Menyimpan…':'Simpan'}</button> <button type="button" disabled={busy} onClick={()=>setForm(null)} className="px-4 py-2">Batal</button></form>}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4">
        <div><p className="text-sm text-slate-500">Paket akun · {subscription?.plan?.name||'Memuat paket…'}</p><p className="font-semibold text-slate-900 mt-1">{used!==undefined&&limit!==null?`${used} outlet dipakai dari ${limit} slot`:'Memuat kapasitas paket…'}</p><p className="text-slate-600 text-sm mt-1">{remaining!==null?`${remaining} slot masih tersedia. `:''}Batas ini gabungan seluruh bisnis, bukan batas per bisnis.</p>{free&&activeOutlets!==undefined&&<p className="text-sm text-slate-500 mt-1">{activeOutlets} outlet tersimpan; paket Free hanya membuka outlet pilihan owner.</p>}</div>
        <div className="flex gap-3"><button disabled={free} className="rounded-xl bg-amber-400 px-4 py-2 font-semibold text-slate-900 disabled:opacity-50" onClick={()=>remaining!==null&&remaining>0?openOutletForm():navigate('/subscription?intent=add-outlet')}>{remaining!==null&&remaining>0?'Gunakan slot · tambah outlet':'Beli tambahan slot'}</button><button className="rounded-xl border border-slate-200 px-4 py-2 font-semibold" onClick={()=>navigate('/subscription?intent=upgrade')}>Lihat paket akun</button></div>
      </div>
      {error&&<p role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-900">{error}</p>}
      {directory?.businesses.map(business=>{const availability=businessAvailability(business);return <article key={business.businessId} className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-lg flex items-center gap-2"><Building2 size={20}/>{business.name}</h2><p className="text-sm text-slate-500 mt-1">{sectorLabel(business.sector)} · {availability.label} · {availability.active.length} outlet aktif{current?.businessId===business.businessId?' · Sedang dibuka di perangkat ini':''}</p></div>
        <button disabled={business.status!=='ACTIVE'||!business.transportRef||free&&current.businessId!==business.businessId} onClick={()=>choose(business.businessId)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Buka bisnis</button></div>
        <ul className="mt-4 divide-y divide-slate-100">{availability.active.map(outlet=><li key={outlet.outletId} className="py-3 flex flex-wrap items-center gap-3"><MapPin size={17} className="text-slate-400"/><div className="flex-1"><p className="font-medium">{outlet.name}{settings.activeBranchId===outlet.outletId?' · Outlet saat ini':''}</p>{outlet.address&&<p className="text-sm text-slate-500">{outlet.address}</p>}</div><span className="text-sm text-emerald-700">{free&&subscription?.freeSelection?.branchId!==outlet.outletId?'Tersimpan · dibatasi paket Free':'Memakai 1 slot'}</span><button disabled={business.status!=='ACTIVE'||free&&subscription?.freeSelection?.branchId!==outlet.outletId} onClick={()=>choose(business.businessId,outlet.outletId)} className="rounded-lg border px-3 py-2 disabled:opacity-40">{settings.activeBranchId===outlet.outletId?'Sedang dipakai':'Buka outlet'}</button></li>)}</ul>
        {availability.inactive.length>0&&<details className="mt-3 rounded-xl bg-slate-50 p-3"><summary className="cursor-pointer text-sm text-slate-600">{availability.inactive.length} outlet belum dibuka / nonaktif · tidak memakai slot</summary><p className="text-xs text-slate-500 mt-2">Entri lama tetap disimpan untuk riwayat. Ini bukan tambahan outlet aktif atau salinan transaksi.</p><ul className="mt-2 space-y-2">{availability.inactive.map(outlet=><li key={outlet.outletId} className="text-sm text-slate-600">{outlet.name}{outlet.address?' · '+outlet.address:''}</li>)}</ul></details>}
        {!business.outlets.length&&<p className="mt-4 text-slate-500">Belum ada cabang.</p>}
      </article>;})}
      {directory&&!directory.businesses.length&&<p className="text-slate-500">Belum ada bisnis terdaftar.</p>}
      <p className="text-sm text-slate-500">Pengelolaan cabang bisnis saat ini tersedia di <button className="underline font-medium" onClick={()=>navigate('/settings')}>Pengaturan</button>. Sinkronisasi berjalan otomatis. Data bisnis lama dan antrean transaksi tetap tersimpan saat berpindah.</p>
    </div>
  </section>;
}
