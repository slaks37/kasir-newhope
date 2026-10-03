import React,{useState,useEffect,useRef} from 'react';
import SidePanel from '../SidePanel';
import SubscriptionDetail from './SubscriptionDetail';
import {api,rupiah,tanggal} from '../api';
import {PAID_SAAS_PLANS,findSaaSPlan} from '../../config/saasPlans';
import {Card,Table,Th,Td,Loading,ErrorBox,Pagination,SearchBox} from '../ui';
import {sectorLabel} from '../../lib/workspace/businessPresentation';
import {useSearch} from '../useSearch';
const stageLabel=(stage:string)=>({ACTIVATION:'Menyiapkan bisnis',DAILY_OPERATIONS:'Operasional harian',WORKFLOW:'Mengenal alur kerja',OWNER_INSIGHTS:'Meninjau laporan',CONVERSION:'Menjelang akhir trial',CONVERTED:'Pembayaran terverifikasi'}[stage]||stage);

export default function Subscriptions(){
 const [detail,setDetail]=useState<{id:string;name:string}|null>(null);
 const [search,setSearch]=useState(''),[status,setStatus]=useState(''),[offset,setOffset]=useState(0),[version,setVersion]=useState(0);
 const settledSearch=useSearch(search);
 const [showPayments,setShowPayments]=useState(false),[paymentError,setPaymentError]=useState(''),[paymentLoading,setPaymentLoading]=useState(false);
 const [data,setData]=useState<any>(null),[payments,setPayments]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [selected,setSelected]=useState<any>(null),[action,setAction]=useState('NOTE'),[reason,setReason]=useState(''),[busy,setBusy]=useState(false);
 const [planId,setPlanId]=useState('plan-plus-monthly'),[cycle,setCycle]=useState('MONTHLY'),[extras,setExtras]=useState(0),[days,setDays]=useState(7);
 const [invoiceId,setInvoiceId]=useState(''),[history,setHistory]=useState<any[]>([]);
 const selectionVersion=useRef(0);
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  api.subscriptions({search:settledSearch,status,offset,limit:20}).then(result=>{
   if(!active)return;setData(result);setLoading(false);
  }).catch(e=>{if(active){setError(e.message);setLoading(false);}});
  return()=>{active=false;};
 },[settledSearch,status,offset,version]);
 useEffect(()=>{if(!showPayments||!data?.canManage)return;let active=true;setPaymentLoading(true);setPaymentError('');api.payments().then(p=>{if(active)setPayments(p);}).catch(e=>{if(active)setPaymentError(e.message);}).finally(()=>{if(active)setPaymentLoading(false);});return()=>{active=false;};},[showPayments,data?.canManage,version]);
 const choose=(row:any,kind='NOTE',invoice='')=>{selectionVersion.current++;setDetail(null);setError('');setSelected(row);setAction(kind);setReason('');setHistory([]);setInvoiceId(invoice);setPlanId(row.plan_id==='plan-pro-monthly'?row.plan_id:'plan-plus-monthly');setCycle(row.billing_cycle || 'MONTHLY');setExtras(Number(row.extra_outlets || 0));};
 const closeAction=()=>{if(!busy){selectionVersion.current++;setSelected(null);}};
 const submit=async(e:React.FormEvent)=>{
  e.preventDefault();setBusy(true);setError('');
  try{await api.support(selected.id,{action,reason,planId,billingCycle:cycle,extraOutlets:extras,days,invoiceId});setSelected(null);setVersion(v=>v+1);}
  catch(e:any){setError(e.message);}finally{setBusy(false);}
 };
 const s=data?.summary;
 return <div className="space-y-5">
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[['Langganan aktif',s?.active],['Trial aktif',s?.trial],['Read-only / expired',s?.expired],['Konversi trial',s?s.conversionRate+'%':undefined]].map(([label,value])=><Card key={label}><div className="text-xs text-slate-500">{label}</div><div className="text-2xl font-bold">{value ?? '—'}</div></Card>)}</div>
  {s&&<Card title="Funnel trial · data tersinkronisasi"><p>{s.trialEntrants} mulai trial → {s.activated} transaksi pertama → {s.converted} pembayaran terverifikasi.</p><p className="text-xs text-slate-500 mt-2">Konversi = tenant trial dengan pembayaran berhasil / seluruh tenant trial. Paket kompensasi tidak dihitung sebagai pembayaran.</p></Card>}
  {error&&!selected&&<ErrorBox error={{message:error}}/>}
  <Card title="Paket akun pelanggan & seluruh bisnisnya">
   <p className="px-4 pt-4 text-sm text-slate-500">Satu baris = satu akun langganan, bukan satu bisnis. Status ACTIVE berarti paket berlangganan aktif. Outlet dan batas paket dihitung gabungan seluruh bisnis dalam akun.</p>
   <div className="p-4 flex flex-wrap gap-3"><SearchBox value={search} onChange={v=>{setSearch(v);setOffset(0);}} placeholder="Cari nama akun atau bisnis..."/>
    <select aria-label="Status langganan" value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}} className="border rounded p-2">{['','TRIAL','ACTIVE','PAST_DUE','EXPIRED'].map(v=><option key={v} value={v}>{v || 'Semua status'}</option>)}</select></div>
   {loading?<Loading/>:data&&<><div className="overflow-x-auto"><Table><thead><tr><Th>Akun pelanggan / bisnis</Th><Th>Paket / periode</Th><Th>Status paket</Th><Th>Outlet seluruh akun</Th><Th>Tahap penggunaan</Th><Th>Aksi</Th></tr></thead><tbody>
   {data.rows.map((r:any)=><tr key={r.id}><Td><div className="font-semibold">{r.name}</div><small>Akun sejak {tanggal(r.created_at)}</small><ul className="mt-2 space-y-1 text-xs text-slate-500">{(r.businesses||[]).map((business:any)=><li key={business.id}>{business.name} · {sectorLabel(business.business_sector)} · {!business.is_active?'Dinonaktifkan':business.active_outlets?`${business.active_outlets} outlet aktif`:'Belum ada outlet aktif'}</li>)}</ul></Td><Td>{findSaaSPlan(r.plan_id)?.name || 'Free Trial 45 Hari'}<br/>{r.status==='TRIAL'?'45 hari':r.status==='FREE'?'Tanpa batas waktu':r.billing_cycle==='YEARLY'?'Tahunan':'Bulanan'}</Td><Td>{r.status}<br/><small>{r.status==='FREE'?'Tanpa batas waktu':`${r.daysLeft} hari tersisa`} • {r.accessMode==='FULL'?'Akses sesuai paket':'Akses terbatas'}</small></Td><Td>{r.outlet_count} dari {r.maxOutlets} slot<br/><small>{Math.max(0,r.maxOutlets-r.outlet_count)} slot tersedia · add-on: {r.extra_outlets || 0}</small></Td><Td>{stageLabel(r.lifecycleStage)}<br/><small>Transaksi terakhir: {r.last_transaction_at?tanggal(r.last_transaction_at):'belum tercatat'}</small></Td><Td><div className="flex flex-col gap-2">
    {data.canSupport&&<button className="underline" onClick={()=>{selectionVersion.current++;setSelected(null);setDetail({id:r.id,name:r.name});}}>Detail langganan</button>}
    {data.canManage&&<button className="underline" onClick={()=>choose(r,'GRANT_PLAN')}>Ubah tier manual</button>}
    {data.canSupport&&<button className="underline" onClick={()=>choose(r)}>Support</button>}</div></Td></tr>)}
   </tbody></Table></div>{!data.rows.length&&<p className="p-5">Tidak ada tenant yang cocok.</p>}<Pagination offset={offset} total={data.total} limit={20} onChange={setOffset}/></>}
  </Card>
  {detail&&<SubscriptionDetail key={detail.id+':'+version} tenantId={detail.id} name={detail.name} onClose={()=>setDetail(null)}/>}
  {selected&&<SidePanel title={'Tindakan untuk '+selected.name} onClose={closeAction} busy={busy}>
   {error&&<ErrorBox error={{message:error}}/>}
   <form onSubmit={submit} className="space-y-3 p-3">
    <fieldset disabled={busy} className="space-y-3">
    <label className="block">Tindakan <select value={action} onChange={e=>setAction(e.target.value)} className="border rounded p-2 ml-2">
     <option value="NOTE">Catatan support</option>{data?.canManage&&<><option value="EXTEND_TRIAL">Perpanjang trial (maks. 14 hari)</option><option value="GRANT_PLAN">Berikan paket manual / kompensasi</option>{invoiceId&&<option value="PAYMENT_NOTE">Catatan rekonsiliasi</option>}</>}</select></label>
    {action==='GRANT_PLAN'&&<><p className="text-sm text-amber-800">Perubahan akses manual, bukan pembayaran atau refund. Paket aktif mempertahankan tanggal akhir dan nilai pembayaran sebelumnya; siklus paket berbayar tidak dapat diubah lewat kompensasi. Gunakan checkout merchant untuk mengganti siklus billing. Alasan dan nilai sebelum/sesudah diaudit.</p>
     <div className="flex flex-wrap gap-3"><select aria-label="Paket tujuan" value={planId} onChange={e=>setPlanId(e.target.value)} className="border p-2">{PAID_SAAS_PLANS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
     <select aria-label="Periode billing" value={cycle} onChange={e=>setCycle(e.target.value)} className="border p-2"><option>MONTHLY</option><option>YEARLY</option></select>
     <label>Add-on outlet <input aria-label="Jumlah add-on outlet" type="number" min="0" max="100" value={extras} onChange={e=>setExtras(Number(e.target.value))} className="border p-2 w-20"/></label></div></>}
    {action==='EXTEND_TRIAL'&&<label>Tambahan hari <input type="number" min="1" max="14" value={days} onChange={e=>setDays(Number(e.target.value))} className="border p-2"/></label>}
    <label className="block">Alasan / nomor tiket (minimal 10 karakter)<textarea required minLength={10} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} className="border rounded w-full p-3"/></label>
    <div className="flex flex-wrap gap-3"><button disabled={busy||reason.trim().length<10} className="bg-amber-400 text-slate-900 px-4 py-2 rounded disabled:opacity-50">{busy?'Menyimpan…':'Simpan tindakan'}</button><button type="button" onClick={closeAction}>Batal</button>
    <button type="button" disabled={reason.trim().length<10} onClick={async()=>{const version=selectionVersion.current;try{const h=await api.supportHistory(selected.id,reason);if(version===selectionVersion.current)setHistory(h.rows);}catch(e:any){if(version===selectionVersion.current)setError(e.message);}}}>Lihat riwayat</button></div>
    {history.map(h=><p key={h.id} className="text-sm border-t pt-2">{tanggal(h.created_at)} · {h.action} · {h.operator_email}: {h.reason}</p>)}
    </fieldset>
   </form>
  </SidePanel>}
  {data?.canManage&&<button type="button" className="border rounded-lg p-3" onClick={()=>setShowPayments(v=>!v)}>{showPayments?'Tutup':'Buka'} rekonsiliasi pembayaran</button>}
  {showPayments&&paymentLoading&&<Loading/>}{showPayments&&paymentError&&<ErrorBox error={{message:paymentError}}/>}
  {showPayments&&payments&&!paymentLoading&&<Card title="Rekonsiliasi pembayaran · 200 tagihan terakhir"><p className="p-3 text-sm text-slate-500">Nominal dan status dibandingkan dengan notifikasi DOKU bertanda tangan. REVIEW tidak memberi akses otomatis.</p>
   <div className="overflow-x-auto"><Table><thead><tr><Th>Tenant / invoice</Th><Th>Tagihan</Th><Th>Status gateway</Th><Th>Hasil</Th><Th>Aksi</Th></tr></thead><tbody>{payments.rows.map((i:any)=>{const event=payments.events.find((e:any)=>e.invoice_number===i.invoice_number);return <tr key={i.id}><Td>{i.tenant_name}<br/><small>{i.invoice_number || i.id}</small></Td><Td>{rupiah(i.amount)}<br/>{i.quote?.billingCycle}</Td><Td>{event?rupiah(event.amount)+' · '+event.outcome:'Belum ada notifikasi'}</Td><Td>{i.payment_status} / {i.reconciliation_status}<br/><small>{i.reconciliation_note}</small></Td><Td><button className="underline" onClick={()=>choose({id:i.tenant_id,name:i.tenant_name},'PAYMENT_NOTE',i.id)}>Catat pemeriksaan</button></Td></tr>;})}</tbody></Table></div>
   {!payments.rows.length&&<p className="p-4">Belum ada tagihan.</p>}
   {payments.events.filter((e:any)=>e.reason==='INVOICE_NOT_FOUND').map((e:any)=><p key={e.id} className="p-3 text-red-700">Notifikasi tidak cocok: {e.invoice_number} · {rupiah(e.amount)}</p>)}
  </Card>}
 </div>;
}
