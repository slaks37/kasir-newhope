import React,{useEffect,useRef,useState} from 'react';
import {usePOSFields} from '../../context/POSDomains';
import {LegacyRecoveryPanel} from './LegacyRecoveryPanel';
import {operationalRecovery,recoveryGroups} from '../../lib/sync/operationalRecovery';
import {readQuarantine,requeueQuarantined} from '../../lib/sync/queue';
import {formatRupiah} from '../../utils/formatters';

const QUARANTINE_REASON:Record<string,string>={
  TOTAL_MISMATCH:'Total tidak sama dengan subtotal − diskon + pajak + layanan.',
  INVALID_ITEM:'Ada item dengan harga/jumlah tidak valid.',
  INVALID_AMOUNT:'Nominal transaksi tidak valid.',
  INVALID_TRANSACTION:'Data transaksi tidak lengkap.',
  TRANSACTION_ID_CONFLICT:'ID transaksi ini sudah tercatat di cloud dengan nilai berbeda (diedit setelah terkirim).',
};

/** The only user-facing recovery surface. Header only opens this center. */
export function SyncCenter(){
  const {syncCenter,closeSyncCenter,forceSync,resolveOperationalConflict,settings}=usePOSFields(["syncCenter","closeSyncCenter","forceSync","resolveOperationalConflict","settings"]);
  const close=useRef<HTMLButtonElement>(null),[busy,setBusy]=useState('');
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;close.current?.focus();
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')closeSyncCenter();};document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[closeSyncCenter]);
  let backups:ReturnType<typeof operationalRecovery>=[];
  try{backups=operationalRecovery(syncCenter.owner||syncCenter.businessId.replace(/_(FNB|LAUNDRY|RETAIL|CARWASH|BARBERSHOP)$/,''),settings.businessSector||'FNB',syncCenter.operationalNamespace);}catch{}
  const protectedRecords=recoveryGroups(backups);
  const [quarantine,setQuarantine]=useState(()=>readQuarantine(syncCenter.businessId));
  const retrySale=(clientTxnId:string)=>{requeueQuarantined(syncCenter.businessId,clientTxnId);setQuarantine(readQuarantine(syncCenter.businessId));forceSync();};
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
      <div className="flex items-center justify-between gap-3"><h2 id="sync-center-title" className="text-xl font-bold">Kesehatan data & pemulihan</h2>
        <button ref={close} onClick={closeSyncCenter} className="rounded-lg border px-3 py-2">Tutup</button></div>
      <p className="mt-2 font-semibold">{settings.businessSector} · {syncCenter.label}</p>
      <p className="text-sm text-slate-600">Data disimpan otomatis. Tidak perlu menekan tombol untuk mengirim perubahan. Halaman ini hanya untuk pemeriksaan dan pemulihan data lama.</p>
      {syncCenter.lastConfirmedAt&&<p className="text-xs text-slate-500">Terakhir konfirmasi cloud: {new Date(syncCenter.lastConfirmedAt).toLocaleString('id-ID')}</p>}
      {syncCenter.error&&<p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-rose-800">{syncCenter.error}</p>}
      <section className="mt-4 rounded-xl border p-3"><h3 className="font-bold">Keuangan · {syncCenter.financialPending} menunggu</h3>
        <p className="text-sm text-slate-600">Transaksi, kas, void dan refund memakai ledger server. Pilihan data operasional tidak mengubah ledger.</p>
        <LegacyRecoveryPanel />
        {quarantine.length>0&&<div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="font-semibold text-rose-900">{quarantine.length} penjualan ditolak cloud dan disimpan terpisah</p>
          <p className="text-sm text-rose-800">Penjualan lain tetap terkirim. Data asli tersimpan utuh di perangkat ini; jangan hapus data browser.</p>
          <ul className="mt-2 space-y-2 text-sm">{quarantine.map(row=><li key={row.txn.clientTxnId} className="rounded-lg bg-white p-2">
            <p className="font-semibold">{row.txn.invoiceNumber||row.txn.clientTxnId} · {formatRupiah(row.txn.totalAmount)} · {new Date(row.txn.createdAt||row.at).toLocaleString('id-ID')}</p>
            <p className="text-slate-600">{QUARANTINE_REASON[row.error]||`Ditolak server: ${row.error}`}</p>
            <button onClick={()=>retrySale(row.txn.clientTxnId)} className="mt-1 rounded-lg border px-3 py-1">Kirim ulang</button>
          </li>)}</ul>
        </div>}
      </section>
      <section className="mt-4 rounded-xl border p-3"><h3 className="font-bold">Operasional · {syncCenter.operationalPending} menunggu · {syncCenter.operationalConflicts.length} konflik</h3>
        <p className="text-sm text-slate-600">Produk, pelanggan, meja dan setting. Satu konflik tidak menahan record lain.</p>
        {syncCenter.operationalConflicts.map(c=><article key={c.kind+'_'+c.recordId} className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="font-semibold">{c.kind} / {c.recordId}</p>
          <p className="text-sm">Lokal: {c.localLabel||c.recordId} (revisi asal {c.localRevision??0}). Cloud: {c.serverChecked?(c.serverRevision===undefined?'belum tercatat':`${c.serverLabel||c.recordId} · revisi ${c.serverRevision}`):'belum diverifikasi'}.</p>
          {c.error&&c.error!=='STATE_CONFLICT'&&<p className="text-sm">{c.error==='OPERATIONAL_RECORD_TOO_LARGE'?'Catatan lama terlalu besar untuk dikirim. Salinan tetap disimpan. Untuk produk, unggah ulang foto melalui editor agar diperkecil; catatan lain tetap tersinkron otomatis.':c.error}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button disabled={!!busy} onClick={()=>void resolve(c.kind,c.recordId,'server')} className="rounded-lg border bg-white px-3 py-2 disabled:opacity-50">Pakai data server (cadangkan lokal)</button>
            <button disabled={!!busy||!!c.error&&c.error!=='STATE_CONFLICT'} onClick={()=>void resolve(c.kind,c.recordId,'local')} className="rounded-lg bg-amber-400 px-3 py-2 disabled:opacity-50">Pakai perubahan saya</button>
          </div>
        </article>)}
      </section>
      {backups.length>0&&<details className="mt-4 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer font-bold">Data lama diamankan · {protectedRecords.length} catatan</summary>
        <p className="mt-2 text-sm">Salinan yang salah sektor atau sudah digantikan disimpan terpisah dan tidak dikirim ulang. Ini bukan transaksi yang menunggu. Seluruh {backups.length} snapshot asli tetap tersimpan.</p>
        <ul className="mt-2 space-y-2 text-sm">{protectedRecords.map(r=><li key={r.kind+'_'+r.recordId} className="rounded-lg bg-slate-50 p-2">
          <p className="font-semibold">{r.name||({'store_settings':'Pengaturan toko','inventory_logs':'Catatan stok','customers':'Pelanggan','products':'Produk'} as Record<string,string>)[r.kind]||'Catatan operasional'}</p>
          <p className="text-slate-600">{r.reasons.some(reason=>/SECTOR|SCOPE|STORE_MODE/.test(reason))?'Salinan tidak sesuai unit usaha ini; sudah diamankan.':'Versi sebelumnya tetap disimpan sebagai cadangan.'}</p>
          <details className="text-xs text-slate-500"><summary className="cursor-pointer">Detail teknis · {r.sources.length} sumber</summary><p>{r.kind}/{r.recordId}</p><p>{r.reasons.join(' · ')}</p><p className="break-all">{r.sources.join(' · ')}</p></details>
        </li>)}</ul>
      </details>}
      <details className="mt-4 text-sm"><summary className="cursor-pointer text-slate-500">Pemeriksaan lanjutan</summary>
        <button onClick={forceSync} disabled={syncCenter.financial.inFlight||syncCenter.operational.inFlight} className="mt-2 rounded-lg border px-4 py-2 disabled:opacity-50">Periksa koneksi sekarang</button>
        <p className="mt-2 text-xs text-slate-500">Percobaan ulang juga berjalan otomatis. Sistem tidak menebak outlet atau versi transaksi lama. Jangan hapus data browser selama pemulihan belum selesai.</p>
      </details>
    </section>
  </div>;
}
