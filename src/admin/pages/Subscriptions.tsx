import React,{useState,useEffect} from 'react';
import SubscriptionDetail from './SubscriptionDetail';
import {api,rupiah,tanggal} from '../api';
import {PAID_SAAS_PLANS} from '../../config/saasPlans';
import {Card,Table,Th,Td,Loading,ErrorBox,Pagination,SearchBox} from '../ui';

export default function Subscriptions(){
 const [detail,setDetail]=useState<{id:string;name:string}|null>(null);
 const [search,setSearch]=useState(''),[status,setStatus]=useState(''),[offset,setOffset]=useState(0),[version,setVersion]=useState(0);
 const [data,setData]=useState<any>(null),[payments,setPayments]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [selected,setSelected]=useState<any>(null),[action,setAction]=useState('NOTE'),[reason,setReason]=useState(''),[busy,setBusy]=useState(false);
 const [planId,setPlanId]=useState('plan-plus-monthly'),[cycle,setCycle]=useState('MONTHLY'),[extras,setExtras]=useState(0),[days,setDays]=useState(7);
 const [invoiceId,setInvoiceId]=useState(''),[history,setHistory]=useState<any[]>([]);
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  api.subscriptions({search,status,offset,limit:20}).then(async result=>{
   if(!active)return;setData(result);setLoading(false);
   if(result.canManage){try{const p=await api.payments();if(active)setPayments(p);}catch(e:any){if(active)setError(e.message);}}
  }).catch(e=>{if(active){setError(e.message);setLoading(false);}});
  return()=>{active=false;};
 },[search,status,offset,version]);
 const choose=(row:any,kind='NOTE',invoice='')=>{setSelected(row);setAction(kind);setReason('');setHistory([]);setInvoiceId(invoice);setPlanId(row.plan_id==='plan-pro-monthly'?row.plan_id:'plan-plus-monthly');setCycle(row.billing_cycle || 'MONTHLY');setExtras(Number(row.extra_outlets || 0));};
 const submit=async(e:React.FormEvent)=>{
  e.preventDefault();setBusy(true);setError('');
  try{await api.support(selected.id,{action,reason,planId,billingCycle:cycle,extraOutlets:extras,days,invoiceId});setSelected(null);setVersion(v=>v+1);}
  catch(e:any){setError(e.message);}finally{setBusy(false);}
 };
 const s=data?.summary;
 return <div className="space-y-5">
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[['Langganan aktif',s?.active],['Trial aktif',s?.trial],['Read-only / expired',s?.expired],['Konversi trial',s?s.conversionRate+'%':undefined]].map(([label,value])=><Card key={label}><div className="text-xs text-slate-500">{label}</div><div className="text-2xl font-bold">{value ?? '—'}</div></Card>)}</div>
  {s&&<Card title="Funnel trial · data tersinkronisasi"><p>{s.trialEntrants} mulai trial → {s.activated} transaksi pertama → {s.converted} pembayaran terverifikasi.</p><p className="text-xs text-slate-500 mt-2">Konversi = tenant trial dengan pembayaran berhasil / seluruh tenant trial. Paket kompensasi tidak dihitung sebagai pembayaran.</p></Card>}
  {error&&<ErrorBox error={{message:error}}/>}
  <Card title="Langganan, outlet, dan lifecycle">
   <div className="p-4 flex flex-wrap gap-3"><SearchBox value={search} onChange={v=>{setSearch(v);setOffset(0);}} placeholder="Cari tenant..."/>
    <select aria-label="Status langganan" value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}} className="border rounded p-2">{['','TRIAL','ACTIVE','PAST_DUE','EXPIRED'].map(v=><option key={v} value={v}>{v || 'Semua status'}</option>)}</select></div>
   {loading?<Loading/>:data&&<><div className="overflow-x-auto"><Table><thead><tr><Th>Tenant</Th><Th>Paket / periode</Th><Th>Status</Th><Th>Outlet</Th><Th>Lifecycle</Th><Th>Aksi</Th></tr></thead><tbody>
   {data.rows.map((r:any)=><tr key={r.id}><Td><div>{r.name}</div><small>{tanggal(r.created_at)}</small></Td><Td>{r.plan_id || 'Trial'}<br/>{r.billing_cycle || '45 hari'}</Td><Td>{r.status}<br/><small>{r.daysLeft} hari • {r.accessMode}</small></Td><Td>{r.outlet_count} / {r.maxOutlets}<br/><small>add-on: {r.extra_outlets || 0}</small></Td><Td>{r.lifecycleStage}<br/><small>Aktivitas: {r.last_transaction_at?tanggal(r.last_transaction_at):'belum ada'}</small></Td><Td><div className="flex flex-col gap-2">
    {data.canSupport&&<button className="underline" onClick={()=>setDetail({id:r.id,name:r.name})}>Detail langganan</button>}
    {data.canManage&&<button className="underline" onClick={()=>choose(r,'GRANT_PLAN')}>Ubah tier manual</button>}
    {data.canSupport&&<button className="underline" onClick={()=>choose(r)}>Support</button>}</div></Td></tr>)}
   </tbody></Table></div>{!data.rows.length&&<p className="p-5">Tidak ada tenant yang cocok.</p>}<Pagination offset={offset} total={data.total} limit={20} onChange={setOffset}/></>}
  </Card>
  {detail&&<SubscriptionDetail key={detail.id+':'+version} tenantId={detail.id} name={detail.name} onClose={()=>setDetail(null)}/>}
  {selected&&<Card title={'Tindakan untuk '+selected.name}>
   <form onSubmit={submit} className="space-y-3 p-3">
    <label className="block">Tindakan <select value={action} onChange={e=>setAction(e.target.value)} className="border rounded p-2 ml-2">
     <option value="NOTE">Catatan support</option>{data?.canManage&&<><option value="EXTEND_TRIAL">Perpanjang trial (maks. 14 hari)</option><option value="GRANT_PLAN">Berikan paket manual / kompensasi</option>{invoiceId&&<option value="PAYMENT_NOTE">Catatan rekonsiliasi</option>}</>}</select></label>
    {action==='GRANT_PLAN'&&<><p className="text-sm text-amber-800">Perubahan akses manual, bukan pembayaran atau refund. Paket aktif mempertahankan tanggal akhir dan nilai pembayaran sebelumnya; siklus paket berbayar tidak dapat diubah lewat kompensasi. Gunakan checkout merchant untuk mengganti siklus billing. Alasan dan nilai sebelum/sesudah diaudit.</p>
     <div className="flex flex-wrap gap-3"><select aria-label="Paket tujuan" value={planId} onChange={e=>setPlanId(e.target.value)} className="border p-2">{PAID_SAAS_PLANS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
     <select aria-label="Periode billing" value={cycle} onChange={e=>setCycle(e.target.value)} className="border p-2"><option>MONTHLY</option><option>YEARLY</option></select>
     <label>Add-on outlet <input aria-label="Jumlah add-on outlet" type="number" min="0" max="100" value={extras} onChange={e=>setExtras(Number(e.target.value))} className="border p-2 w-20"/></label></div></>}
    {action==='EXTEND_TRIAL'&&<label>Tambahan hari <input type="number" min="1" max="14" value={days} onChange={e=>setDays(Number(e.target.value))} className="border p-2"/></label>}
    <label className="block">Alasan / nomor tiket (minimal 10 karakter)<textarea required minLength={10} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} className="border rounded w-full p-3"/></label>
    <div className="flex gap-3"><button disabled={busy} className="bg-slate-900 text-white px-4 py-2 rounded">{busy?'Menyimpan…':'Simpan tindakan'}</button><button type="button" onClick={()=>setSelected(null)}>Batal</button>
    <button type="button" disabled={reason.trim().length<10} onClick={async()=>{try{const h=await api.supportHistory(selected.id,reason);setHistory(h.rows);}catch(e:any){setError(e.message);}}}>Lihat riwayat</button></div>
    {history.map(h=><p key={h.id} className="text-sm border-t pt-2">{tanggal(h.created_at)} · {h.action} · {h.operator_email}: {h.reason}</p>)}
   </form>
  </Card>}
  {payments&&<Card title="Rekonsiliasi pembayaran · 200 tagihan terakhir"><p className="p-3 text-sm text-slate-500">Nominal dan status dibandingkan dengan notifikasi DOKU bertanda tangan. REVIEW tidak memberi akses otomatis.</p>
   <div className="overflow-x-auto"><Table><thead><tr><Th>Tenant / invoice</Th><Th>Tagihan</Th><Th>Status gateway</Th><Th>Hasil</Th><Th>Aksi</Th></tr></thead><tbody>{payments.rows.map((i:any)=>{const event=payments.events.find((e:any)=>e.invoice_number===i.invoice_number);return <tr key={i.id}><Td>{i.tenant_name}<br/><small>{i.invoice_number || i.id}</small></Td><Td>{rupiah(i.amount)}<br/>{i.quote?.billingCycle}</Td><Td>{event?rupiah(event.amount)+' · '+event.outcome:'Belum ada notifikasi'}</Td><Td>{i.payment_status} / {i.reconciliation_status}<br/><small>{i.reconciliation_note}</small></Td><Td><button className="underline" onClick={()=>choose({id:i.tenant_id,name:i.tenant_name},'PAYMENT_NOTE',i.id)}>Catat pemeriksaan</button></Td></tr>;})}</tbody></Table></div>
   {!payments.rows.length&&<p className="p-4">Belum ada tagihan.</p>}
   {payments.events.filter((e:any)=>e.reason==='INVOICE_NOT_FOUND').map((e:any)=><p key={e.id} className="p-3 text-red-700">Notifikasi tidak cocok: {e.invoice_number} · {rupiah(e.amount)}</p>)}
  </Card>}
 </div>;
}
