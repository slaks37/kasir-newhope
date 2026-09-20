import React,{useMemo,useState} from 'react';
import { buildBusinessBrain, simulatePrice, type BrainAction } from '../../lib/assistant/businessBrain';
import { advanceAction, parseActionJournal, type ActionRecord } from '../../lib/assistant/actionJournal';
import type { MerchantSnapshot } from '../../lib/assistant/types';
import { formatRupiah as rp } from '../../utils/formatters';
import { isFreePlan } from '../../config/freePlanPolicy';
import { newId } from '../../lib/ids';

const card='rounded-2xl border border-slate-200 bg-white p-4 shadow-xs';
const button='rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50';
export function IntelligencePanel({snapshot,compact=false,onOpen}:{snapshot:MerchantSnapshot;compact?:boolean;onOpen?:()=>void}) {
  const enabled=!isFreePlan(snapshot.settings.subscription)&&['ADMIN','MANAGER'].includes(snapshot.userRole);
  const brain=useMemo(()=>enabled?buildBusinessBrain(snapshot):null,[snapshot,enabled]);
  const storageKey=`newhope_brain_actions_v1_${snapshot.businessId}`;
  const [journal,setJournal]=useState<ActionRecord[]>(()=>{try{return parseActionJournal(localStorage.getItem(storageKey)||'[]',snapshot.businessId);}catch{return [];}});
  const [selected,setSelected]=useState('');const [price,setPrice]=useState('');const [loss,setLoss]=useState('0');
  const [error,setError]=useState('');const [note,setNote]=useState('');const [group,setGroup]=useState<any[]|null>(null);
  if(!brain)return null;
  const v=brain.sales; const product=snapshot.products.find(p=>p.id===selected);const menu=brain.menu.find(p=>p.productId===selected);
  const simulation=product&&menu?.currentCost!=null&&price?simulatePrice(product.price,menu.currentCost,Number(price),menu.quantity,Number(loss)):null;
  function persist(rows:ActionRecord[]){try{localStorage.setItem(storageKey,JSON.stringify(rows));setJournal(rows);setError('');}catch{setError('Draft belum tersimpan: penyimpanan perangkat tidak tersedia.');}}
  function draft(action:BrainAction){if(snapshot.userRole!=='ADMIN')return;persist([...journal,{id:newId('brain'),businessId:snapshot.businessId,action,status:'DRAFT' as const,createdAt:new Date().toISOString()}].slice(-100));}
  function advance(row:ActionRecord,status:ActionRecord['status']){try{const next=advanceAction(row,status,snapshot,new Date(),note);persist(journal.map(r=>r.id===row.id?next:r));setNote('');}catch(e){setError((e as Error).message);}}
  async function loadGroup(){try{const r=await fetch('/api/v1/assistant/group');const d=await r.json();if(!r.ok)throw new Error(d.error||'Group BI belum tersedia');setGroup(d.outlets);setError('');}catch{setError('Analisis lintas outlet belum tersedia. Pastikan sesi owner aktif dan backend sudah diperbarui.');}}
  return <section aria-label="New Hope Business Intelligence" className="space-y-4 text-slate-800">
    <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold tracking-wide text-amber-700">NEW HOPE INTELLIGENCE · TANPA TOKEN</p><h3 className="mt-1 text-xl font-extrabold">Business Daily Brief</h3></div><span className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs">Data perangkat · WIB</span></div>
      <p className="mt-1 text-xs text-slate-500">{snapshot.storeName} · {v.date} · bukan gabungan seluruh terminal</p>
      <div className="my-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Omzet kemarin',rp(v.revenue)],['Transaksi',String(v.orders)],['Vs hari sejenis',v.revenueChangePct===null?'Belum cukup data':`${v.revenueChangePct}%`],['Skenario akhir bulan',v.projectedMonthEnd===null?'Butuh ≥7 hari lengkap':rp(v.projectedMonthEnd)]].map(([label,value])=><div key={label}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>)}
      </div>
      {v.transactionEffect!==null?<p className="text-sm">Perubahan terkait jumlah transaksi <b>{rp(v.transactionEffect)}</b> dan rata-rata belanja <b>{rp(v.basketEffect!)}</b>. Bukan bukti sebab-akibat.</p>:<p className="text-sm text-slate-600">Butuh minimal empat hari sejenis untuk perbandingan yang layak.</p>}
      {brain.actions.length>0?<ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{brain.actions.slice(0,3).map(a=><li key={a.id}>{a.title}</li>)}</ul>:<p className="mt-3 text-sm text-slate-500">Belum ada rekomendasi dengan data yang cukup. Transaksi dan HPP yang lengkap akan memperkaya analisis.</p>}
      {compact&&onOpen?<button className={`${button} mt-4`} onClick={onOpen}>Buka analisis & rencana tindakan</button>:null}
    </div>
    {!compact?<>
      <div className="grid gap-4 xl:grid-cols-2">
        <details className={card} open><summary className="cursor-pointer font-bold">Demand Forecast & Pembelian</summary><p className="my-2 text-xs text-slate-500">Tujuh hari ke depan, mulai besok. Rentang indikatif; belum memasukkan cuaca, promo, hari tutup atau stockout.</p>
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="py-2">Produk</th><th>Besok</th><th>Rentang</th><th>MAE uji</th></tr></thead><tbody>{brain.demand.slice(0,10).map(f=><tr className="border-t border-slate-100" key={f.productId}><td className="py-2">{f.name}</td><td>{f.days[0]?.expected??'Data <14 hari'} {f.days.length?f.unit:''}</td><td>{f.days[0]?`${f.days[0].low}–${f.days[0].high}`:'—'}</td><td>{f.backtest?`${f.backtest.mae} (${f.backtest.points} hari)`:'—'}</td></tr>)}</tbody></table></div>
          <h4 className="mt-4 text-sm font-bold">Kebutuhan tambahan · batas atas 7 hari</h4>{brain.procurement.length?brain.procurement.slice(0,10).map(p=><p className="mt-2 text-sm" key={p.itemId}>{p.name}: <b>{p.suggestedQty} {p.unit}</b> · {p.estimatedCost===null?'HPP belum lengkap':rp(p.estimatedCost)}</p>):<p className="mt-2 text-xs">Belum ada draft pembelian dengan data yang cukup.</p>}
          <p className="mt-3 text-xs text-slate-500">Konfirmasi supplier, MOQ, lead time dan pesanan masuk. Belum membuat PO atau mengirim pesan.</p>
        </details>
        <details className={card} open><summary className="cursor-pointer font-bold">Menu Engineering & Simulasi Harga</summary><p className="my-2 text-xs text-slate-500">Penjualan 30 hari lengkap. Kontribusi setelah diskon, sebelum pajak dan biaya operasional; HPP historis wajib lengkap.</p>
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="py-2">Produk</th><th>Kuadran</th><th>Kontribusi</th><th>HPP lengkap</th></tr></thead><tbody>{brain.menu.slice(0,10).map(m=><tr className="border-t border-slate-100" key={m.productId}><td className="py-2">{m.name}</td><td>{m.quadrant}</td><td>{m.contribution===null?'—':rp(m.contribution)}</td><td>{m.costCoveragePct}%</td></tr>)}</tbody></table></div>
          <div className="mt-4 space-y-2"><label className="block text-xs">Produk simulasi<select value={selected} onChange={e=>{setSelected(e.target.value);setPrice('');}} className="mt-1 w-full rounded-lg border border-slate-200 p-2"><option value="">Pilih produk</option>{snapshot.products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2"><label className="text-xs">Harga baru (Rp)<input type="number" min="1" value={price} onChange={e=>setPrice(e.target.value)} className="mt-1 w-full rounded-lg border p-2"/></label><label className="text-xs">Asumsi volume turun (%)<input type="number" min="0" max="100" value={loss} onChange={e=>setLoss(e.target.value)} className="mt-1 w-full rounded-lg border p-2"/></label></div>
          {simulation?<p className="rounded-xl bg-emerald-50 p-3 text-sm">Margin baru {simulation.marginPct}%. Perubahan kontribusi {rp(simulation.delta)}. Batas penurunan volume untuk impas {simulation.breakEvenVolumeLossPct??'—'}%. <b>Ini simulasi, bukan prediksi demand. Harga tidak diubah.</b></p>:<p className="text-xs text-slate-500">Pilih produk dengan HPP lengkap dan harga di atas modal.</p>}</div>
        </details>
        <details className={card}><summary className="cursor-pointer font-bold">Customer Intelligence & Nilai Pelanggan</summary><p className="my-2 text-xs text-slate-500">Berdasarkan transaksi teramati. Nilai 12 bulan = skenario laju historis, bukan CLV bersih. Minimal 90 hari dan lima transaksi.</p>
          <div className="flex flex-wrap gap-2">{['CHAMPION','LOYAL','POTENTIAL','AT_RISK','HIBERNATING','LOST','NEW'].map(seg=><span key={seg} className="rounded-lg bg-slate-100 p-2 text-xs">{seg}: {brain.customers.filter(c=>c.segment===seg).length}</span>)}</div>
          {brain.customers.slice(0,10).map(c=><div key={c.id} className="mt-2 border-t pt-2 text-sm"><b>{c.name}</b> · {c.segment}<p>{c.orders} transaksi · {rp(c.revenue)} historis · skenario 12 bulan {c.projected12m===null?'belum cukup data':rp(c.projected12m)}</p></div>)}
          {!brain.customers.length?<p className="mt-2 text-sm">Belum ada pelanggan teridentifikasi.</p>:null}
        </details>
        <details className={card}><summary className="cursor-pointer font-bold">Operasional, Staf & Anomali</summary><p className="my-2 text-sm">{brain.workforce.completedShifts} shift lengkap · {brain.workforce.ordersPerHour??'—'} transaksi/jam kasir.</p><p className="text-xs text-slate-500">Jam kasir bukan jam seluruh kru. Belum menetapkan jumlah pegawai optimal atau menuduh fraud.</p>
          {brain.anomalies.map(a=><p key={a.id} className="mt-3 rounded-lg bg-amber-50 p-3 text-sm"><b>{a.title}</b><br/>{a.evidence}</p>)}{!brain.anomalies.length?<p className="mt-2 text-sm">Tidak ada flag yang memenuhi syarat. Bukan jaminan tidak ada masalah.</p>:null}
          <h4 className="mt-4 text-sm font-bold">{brain.sector.title}</h4>{brain.sector.metrics.map(m=><p key={m.label} className="text-sm">{m.label}: {m.value}</p>)}{brain.sector.missing.map(m=><p key={m} className="mt-2 text-xs text-slate-500">{m}</p>)}
        </details>
      </div>
      <div className={card}><h3 className="font-bold">Data → Rekomendasi → Tindakan → Pengukuran</h3><p className="mt-1 text-xs text-slate-500">Draft dan persetujuan disimpan di perangkat ini, per unit usaha. Tidak mengeksekusi pembelian, diskon, perubahan harga atau pengiriman kampanye.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">{brain.actions.map(a=><div key={a.id} className="rounded-xl border border-slate-200 p-3"><h4 className="text-sm font-bold">{a.title}</h4><p className="my-2 text-xs text-slate-600">{a.reason}</p><button className={button} disabled={snapshot.userRole!=='ADMIN'||journal.some(j=>j.action.id===a.id&&j.status!=='MEASURED')} onClick={()=>draft(a)}>Simpan draft untuk owner</button></div>)}</div>
        {journal.length?<label className="mt-4 block text-xs">Catatan pelaksanaan (wajib saat menandai selesai)<input className="mt-1 w-full rounded-xl border border-slate-200 p-2" value={note} onChange={e=>setNote(e.target.value)} placeholder="Apa yang benar-benar sudah dilakukan?"/></label>:null}
        {journal.map(r=><details key={r.id} className="mt-3 rounded-xl bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-bold">{r.action.title} · {r.status}</summary><pre className="my-2 whitespace-pre-wrap font-sans text-xs">{r.action.draft}</pre><p className="text-xs">{r.note}</p><div className="mt-2 flex gap-2">{r.status==='DRAFT'?<button className={button} disabled={snapshot.userRole!=='ADMIN'} onClick={()=>advance(r,'APPROVED')}>Setujui rencana</button>:null}{r.status==='APPROVED'?<button className={button} disabled={snapshot.userRole!=='ADMIN'} onClick={()=>advance(r,'DONE')}>Catat sudah dilaksanakan</button>:null}{r.status==='DONE'?<button className={button} disabled={snapshot.userRole!=='ADMIN'} onClick={()=>advance(r,'MEASURED')}>Ukur setelah 7 hari</button>:null}</div>{r.measurement?<p className="mt-2 text-sm">{r.measurement.label}: {r.measurement.before.toLocaleString('id-ID')} sebelum → {r.measurement.after.toLocaleString('id-ID')} sesudah (7 hari). Perbandingan observasional, bukan bukti dampak kausal.</p>:null}</details>)}
      </div>
      {snapshot.userRole==='ADMIN'?<div className={card}><button className={button} onClick={loadGroup}>Analisis lintas outlet · data pusat</button><p className="mt-2 text-xs text-slate-500">Hanya outlet milik akun owner terverifikasi. Cakupan terpisah dari brief perangkat.</p>{group?<div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Usaha / outlet</th><th>Omzet 30 hari</th><th>Vs 30 hari sebelumnya</th></tr></thead><tbody>{group.map(o=><tr key={o.id} className="border-t"><td className="py-2">{o.businessName} / {o.name}</td><td>{rp(o.revenue)}</td><td>{o.growthPct===null?'Belum ada pembanding':`${o.growthPct}%`}</td></tr>)}</tbody></table></div>:null}</div>:null}
      {error?<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>:null}
      <details className={card}><summary className="cursor-pointer text-sm font-bold">Cakupan data & batas analisis</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">{brain.limitations.map(t=><li key={t}>{t}</li>)}</ul></details>
    </>:null}
  </section>;
}
