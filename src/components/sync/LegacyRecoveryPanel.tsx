import React,{useState} from 'react';
import {usePOS} from '../../context/POSContext';

export function LegacyRecoveryPanel(){
  const {legacyMigrationStatus:status,settings,mapLegacyOutlet,forceSync}=usePOS();
  const [error,setError]=useState('');
  if(!status||status.complete)return null;
  const branches=(settings.branches||[]).filter(branch=>branch.isActive&&branch.businessSector===settings.businessSector);
  return <details className="m-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
    <summary className="cursor-pointer font-bold">Pemulihan data perangkat: {status.queued+status.deferredCashMovements} catatan menunggu cloud</summary>
    <p className="mt-2">{status.acknowledged} transaksi dikonfirmasi server. Salinan data asli tetap disimpan di perangkat ini; jangan hapus data browser sebelum pemulihan selesai.</p>
    {status.unmappedOutletRefs.map(ref=><label key={ref} className="mt-3 block">Outlet asal: {ref==='__unassigned__'?'belum tercatat':ref}
      <select defaultValue="" aria-label={`Hubungkan outlet asal ${ref}`} className="ml-2 rounded-lg border border-amber-300 bg-white p-2" onChange={event=>{
        if(!event.target.value)return;
        const branch=branches.find(branch=>branch.id===event.target.value);
        if(!window.confirm(`Konfirmasi: catatan lama dari ${ref} memang berasal dari ${branch?.name}? Outlet asal transaksi tidak boleh dipindah hanya untuk mengatasi limit.`)){event.target.value='';return;}
        try{mapLegacyOutlet(ref,event.target.value);setError('');}catch(cause){setError(cause instanceof Error?cause.message:'Mapping gagal');}
      }}><option value="">Pilih outlet asal yang benar</option>{branches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>
    </label>)}
    {(status.invalid>0||status.conflicts>0||status.deferredRefunds>0)&&<p className="mt-2" role="alert">{status.invalid} catatan tidak valid, {status.conflicts} konflik ID, {status.deferredRefunds} refund perlu ditinjau. Tidak ada data yang dihapus atau dipaksa masuk.</p>}
    {status.unassignedSourceKeys.length>0&&<p className="mt-2">{status.unassignedSourceKeys.length} sumber lama belum jelas pemiliknya; tidak diimpor otomatis ke akun ini.</p>}
    {(status.error||error)&&<p className="mt-2" role="alert">{status.error||error}</p>}
    <button onClick={forceSync} className="mt-3 rounded-lg border border-amber-400 bg-white px-3 py-2 font-semibold">Coba sinkronisasi lagi</button>
  </details>;
}
