import React, { useEffect, useRef, useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { useAuth } from '../../context/AuthContext';
import { FREE_PRODUCT_LIMIT } from '../../config/freePlanPolicy';

export function FreePlanSelection({onClose}: {onClose?:()=>void}) {
  const {products,settings}=usePOS();
  const {session}=useAuth();
  const saved=settings.subscription?.freeSelection?.sector===(settings.businessSector||'FNB')?settings.subscription.freeSelection:undefined;
  const [ids,setIds]=useState<string[]>(saved?.productIds || []);
  const [branchId,setBranchId]=useState(saved?.branchId || '');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const dialogRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    dialogRef.current?.querySelector<HTMLElement>('select')?.focus();
    return ()=>previous?.focus();
  },[]);
  const sector=settings.businessSector || 'FNB';
  const branches=(settings.branches || []).filter(b=>b.isActive && (!b.businessSector || b.businessSector===sector));
  const save=async()=>{
    setBusy(true); setError('');
    try {
      if (!session?.access_token) throw new Error('Silakan login kembali.');
      const res=await fetch('/api/v1/subscription/free-plan',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify({productIds:ids,branchId,sector})});
      const result=await res.json();
      if(!res.ok || !result.ok) {
        const messages:Record<string,string>={
          FREE_PRODUCT_BRANCH_MISMATCH:'Ada produk yang masih terhubung ke cabang lain. Pilih cabang asal produk atau pilih produk lain. Data dan stok lama tidak dipindahkan.',
          BRANCH_NOT_OWNED:'Cabang ini tidak tersedia untuk akun Anda. Muat ulang daftar cabang.',
          INVALID_FREE_SELECTION:'Pilih 1 cabang dan maksimal 10 produk yang berbeda.',
          FREE_PLAN_NOT_ELIGIBLE:'Status paket berubah. Muat ulang halaman untuk memeriksa langganan.',
        };
        throw new Error(messages[result.error] || 'Pilihan belum tersimpan. Periksa koneksi lalu coba lagi.');
      }
      window.dispatchEvent(new CustomEvent('subscription-updated'));
      onClose?.();
    } catch(e) { setError(e instanceof Error?e.message:'Gagal menyimpan.'); }
    finally {setBusy(false);}
  };
  return <div ref={dialogRef} className="nh-free-dialog fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="free-title" onKeyDown={e=>{
    if(e.key==='Escape' && onClose && !busy) onClose();
    if(e.key==='Tab') {
      const items=dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)');
      if(!items?.length) return;
      const first=items[0],last=items[items.length-1];
      if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
    }
  }}>
    <div className="bg-white rounded-2xl p-6 w-full max-w-xl max-h-[90vh] overflow-auto space-y-4">
      <h2 id="free-title" className="text-xl font-bold">Free selamanya — pilih yang tetap aktif</h2>
      <p>Trial 45 hari sudah selesai. Gunakan maksimal 10 produk, 1 cabang, dan akun owner saja. AI nonaktif. Semua data lain tetap disimpan dan dapat dipakai kembali setelah upgrade.</p>
      <label className="block">Cabang aktif
        <select className="block w-full border border-slate-200 rounded-lg p-2" value={branchId} onChange={e=>setBranchId(e.target.value)} disabled={busy}>
          <option value="">Pilih 1 cabang</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      {!branches.length&&<p role="status" className="text-sm text-amber-800">Daftar cabang belum tersedia. Sambungkan internet lalu muat ulang; data lokal tetap disimpan.</p>}
      <p className="font-semibold">Produk aktif: {ids.length}/{FREE_PRODUCT_LIMIT} · {sector}</p>
      <p className="text-sm text-slate-600">Produk baru tetap tersimpan di inventori. Pilih di sini agar dapat dijual di POS; maksimal 10 produk aktif sekaligus.</p>
      <div className="max-h-72 overflow-auto border border-slate-200 rounded-lg divide-y divide-slate-200">{products.length===0&&<p className="p-3 text-sm text-slate-600">Belum ada produk. Simpan pilihan cabang dahulu, lalu tambahkan produk melalui Inventori.</p>}{products.map(p=><label key={p.id} className="flex gap-3 p-3">
        <input type="checkbox" checked={ids.includes(p.id)} disabled={busy || (!ids.includes(p.id)&&ids.length>=FREE_PRODUCT_LIMIT)}
          onChange={e=>setIds(prev=>e.target.checked?[...prev,p.id]:prev.filter(id=>id!==p.id))}/>{p.name}
      </label>)}</div>
      {error&&<p role="alert" className="text-red-700">{error}</p>}
      <button className="nh-app-button-primary" disabled={busy||!branchId} onClick={save}>{busy?'Menyimpan…':'Simpan pilihan Free'}</button>
      {onClose&&<button className="ml-3" onClick={onClose} disabled={busy}>Batal</button>}
    </div>
  </div>;
}
