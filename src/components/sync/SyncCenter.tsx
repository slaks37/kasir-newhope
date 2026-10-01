import React,{useEffect,useRef,useState} from 'react';
import {usePOS} from '../../context/POSContext';
import {LegacyRecoveryPanel} from './LegacyRecoveryPanel';
import {operationalRecovery} from '../../lib/sync/operationalRecovery';

/** The only user-facing recovery surface. Header only opens this center. */
export function SyncCenter(){
  const {syncCenter,closeSyncCenter,forceSync,resolveOperationalConflict,settings}=usePOS();
  const close=useRef<HTMLButtonElement>(null),[busy,setBusy]=useState('');
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;close.current?.focus();
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')closeSyncCenter();};document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[closeSyncCenter]);
  let backups:ReturnType<typeof operationalRecovery>=[];
  try{backups=operationalRecovery(syncCenter.businessId.replace(/_(FNB|LAUNDRY|RETAIL|CARWASH|BARBERSHOP)$/,''),settings.businessSector||'FNB');}catch{}
  const resolve=async(kind:string,recordId:string,choice:'server'|'local')=>{
    setBusy(kind+recordId);try{await resolveOperationalConflict(kind,recordId,choice);}finally{setBusy('');}
  };
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/40 p-3" role="dialog" aria-modal="true" aria-labelledby="sync-center-title"
    onKeyDown={e=>{if(e.key==='Tab'){
      const nodes=e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),select,input,[tabindex="0"]');
      if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }}}>
    <section className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl">
      <div className="flex items-center justify-between gap-3"><h2 id="sync-center-title" className="text-xl font-bold">Sync Center</h2>
        <button ref={close} onClick={closeSyncCenter} className="rounded-lg border px-3 py-2">Tutup</button></div>
      <p className="mt-2 font-semibold">{settings.businessSector} · {syncCenter.label}</p>
      <p className="text-sm text-slate-600">{syncCenter.detail}. Cadangan tidak dihitung sebagai antrean aktif.</p>
      {syncCenter.lastConfirmedAt&&<p className="text-xs text-slate-500">Terakhir konfirmasi cloud: {new Date(syncCenter.lastConfirmedAt).toLocaleString('id-ID')}</p>}
      {syncCenter.error&&<p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-rose-800">{syncCenter.error}</p>}
      <section className="mt-4 rounded-xl border p-3"><h3 className="font-bold">Keuangan · {syncCenter.financialPending} menunggu</h3>
        <p className="text-sm text-slate-600">Transaksi, kas, void dan refund memakai ledger server. Pilihan data operasional tidak mengubah ledger.</p>
        <LegacyRecoveryPanel />
      </section>
      <section className="mt-4 rounded-xl border p-3"><h3 className="font-bold">Operasional · {syncCenter.operationalPending} menunggu · {syncCenter.operationalConflicts.length} konflik</h3>
        <p className="text-sm text-slate-600">Produk, pelanggan, meja dan setting. Satu konflik tidak menahan record lain.</p>
        {syncCenter.operationalConflicts.map(c=><article key={c.kind+'_'+c.recordId} className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="font-semibold">{c.kind} / {c.recordId}</p>
          <p className="text-sm">Lokal: {c.localLabel||c.recordId} (revisi asal {c.localRevision??0}). Cloud: {c.serverChecked?(c.serverRevision===undefined?'belum tercatat':`${c.serverLabel||c.recordId} · revisi ${c.serverRevision}`):'belum diverifikasi'}.</p>
          {c.error&&c.error!=='STATE_CONFLICT'&&<p className="text-sm">{c.error}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button disabled={!!busy} onClick={()=>void resolve(c.kind,c.recordId,'server')} className="rounded-lg border bg-white px-3 py-2 disabled:opacity-50">Pakai data server (cadangkan lokal)</button>
            <button disabled={!!busy||!!c.error&&c.error!=='STATE_CONFLICT'} onClick={()=>void resolve(c.kind,c.recordId,'local')} className="rounded-lg bg-amber-400 px-3 py-2 disabled:opacity-50">Pakai perubahan saya</button>
          </div>
        </article>)}
      </section>
      {backups.length>0&&<details className="mt-4 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer font-bold">Cadangan operasional / karantina ({backups.length})</summary>
        <p className="mt-2 text-sm">Data salah sektor dikeluarkan dari antrean aktif, bukan dipindah atau ditimpa ke sektor lain. Data asli tetap ada dalam cadangan pada perangkat ini.</p>
        <ul className="mt-2 space-y-2 text-xs">{backups.map((b,index)=><li key={index}>{b.capturedAt} · {b.sourceKey}
          <ul>{b.records.map((r,i)=><li key={i}>{r.kind}/{r.recordId} · {r.name} · {r.reason}</li>)}</ul></li>)}</ul>
      </details>}
      <button onClick={forceSync} disabled={syncCenter.financial.inFlight||syncCenter.operational.inFlight} className="mt-4 rounded-lg bg-amber-400 px-4 py-2 font-bold disabled:opacity-50">Periksa & sinkronkan lagi</button>
      <p className="mt-2 text-xs text-slate-500">Retry tidak memilih outlet atau versi keuangan secara otomatis. Jangan hapus data browser selama pemulihan belum selesai.</p>
    </section>
  </div>;
}
