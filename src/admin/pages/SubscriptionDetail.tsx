import React,{useEffect,useState} from 'react';
import {api,rupiah,tanggal} from '../api';
import {Card,ErrorBox,Loading} from '../ui';

export default function SubscriptionDetail({tenantId,name,onClose}:{tenantId:string;name:string;onClose:()=>void}) {
  const [reason,setReason]=useState(''),[query,setQuery]=useState<{reason:string}|null>(null);
  const [data,setData]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  useEffect(()=>{
    if(!query)return;
    let active=true;setLoading(true);setData(null);setError('');
    api.subscriptionDetail(tenantId,query.reason).then(result=>{if(active)setData(result);})
      .catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[tenantId,query]);
  const date=(value:any)=>value?tanggal(value):'Belum tersedia';
  return <Card title={'Detail langganan · '+name}>
    <div className="p-4 space-y-4">
      <button type="button" onClick={onClose} className="underline">Tutup detail</button>
      <form onSubmit={e=>{e.preventDefault();if(reason.trim().length>=10)setQuery({reason:reason.trim()});}} className="space-y-2">
        <label className="block">Alasan akses / nomor tiket (dicatat dalam audit)
          <input required minLength={10} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} className="block border rounded p-2 w-full"/>
        </label>
        <button disabled={loading || reason.trim().length<10} className="bg-slate-900 text-white rounded px-4 py-2">{data?'Muat ulang detail':'Buka detail'}</button>
      </form>
      {loading&&<Loading/>}{error&&<ErrorBox error={{message:error}}/>}
      {data&&<>
        <p className="text-sm text-slate-500">Dibaca: {date(data.retrievedAt)}. Transaksi tersinkronisasi terakhir: {date(data.activity.last_transaction_at)}. Aktivitas offline belum tentu sudah masuk.</p>
        {data.derivedTrial&&<p className="text-amber-800">Trial dihitung dari tanggal pendaftaran. Belum ada record langganan; membuka halaman ini tidak membuat atau mengubahnya.</p>}
        <section aria-label="Ringkasan langganan" className="space-y-2">
          <h3 className="font-semibold">{data.subscription.planName} · {data.subscription.billingCycle || 'Trial'}</h3>
          <p>{data.subscription.status} · {data.subscription.accessMode} · sisa {data.subscription.daysLeft} hari</p>
          <p>Nilai berulang tersimpan: {data.subscription.recurringAmount===null?'Belum tersedia':rupiah(data.subscription.recurringAmount)}. Pemberian paket manual bukan pembayaran.</p>
          <p>Terdaftar: {date(data.tenant.created_at)}<br/>Trial awal: {date(data.subscription.trialStart)} → {date(data.subscription.trialEnd)}<br/>
            Periode akses saat ini: {date(data.subscription.periodStart)} → {date(data.subscription.periodEnd)}<br/>Batas grace: {date(data.subscription.graceEnd)}<br/>Transaksi pertama: {date(data.activity.first_transaction_at)}</p>
          <p>Outlet aktif {data.capacity.used} / {data.capacity.max ?? 'kapasitas tidak dikenal'} · bawaan {data.capacity.included ?? '—'} + add-on {data.capacity.extra} · slot tersisa {data.capacity.remaining ?? '—'}</p>
        </section>
        <section><h3 className="font-semibold">Outlet</h3>{data.outlets.length?data.outlets.map((o:any)=><p key={o.id}>{o.name} · {o.is_active?'Aktif':'Nonaktif'}</p>):<p>Belum ada outlet.</p>}</section>
        <section><h3 className="font-semibold">Invoice terbaru</h3>{data.invoices.length?data.invoices.map((i:any)=><div key={i.id} className="border-t py-2 text-sm"><p>{i.invoice_number || i.id} · {i.currency} {Number(i.amount).toLocaleString('id-ID')}</p><p>{i.payment_status} / {i.reconciliation_status} · {date(i.created_at)} · jatuh tempo {date(i.due_date)}</p>{i.reconciliation_note&&<p>{i.reconciliation_note}</p>}</div>):<p>Belum ada invoice.</p>}</section>
        <section><h3 className="font-semibold">Notifikasi pembayaran terkait</h3>{data.payments.length?data.payments.map((p:any)=><p key={p.id} className="border-t py-2 text-sm">{date(p.created_at)} · {p.invoice_number} · {p.currency} {Number(p.amount).toLocaleString('id-ID')} · {p.outcome} {p.reason}</p>):<p>Belum ada notifikasi yang cocok dengan invoice tenant ini.</p>}</section>
        <section><h3 className="font-semibold">Riwayat support</h3>{data.support.length?data.support.map((s:any)=><div key={s.id} className="border-t py-2 text-sm"><p>{date(s.created_at)} · {s.action} · {s.operator_email}</p><p>{s.reason}</p><small>Request ID: {s.request_id || 'Log lama tanpa request ID'}</small></div>):<p>Belum ada tindakan support.</p>}</section>
        {Object.entries(data.truncated).filter(([,v])=>v).map(([key])=><p key={key} className="text-amber-800">Daftar {key} dibatasi; ini bukan seluruh riwayat.</p>)}
      </>}
    </div>
  </Card>;
}
