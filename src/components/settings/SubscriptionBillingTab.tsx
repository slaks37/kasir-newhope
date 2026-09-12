import React,{useEffect,useState} from 'react';
import {PAID_SAAS_PLANS,annualTotal} from '../../config/saasPlans';
import {formatRupiah,formatDateTime} from '../../utils/formatters';
import {usePOS} from '../../context/POSContext';

async function billingRequest(path:string,body?:any){
 const r=await fetch('/api/v1/subscription/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await r.json();if(!r.ok || !data.ok)throw new Error(data.error || 'Permintaan billing gagal');return data;
}
export const SubscriptionBillingTab:React.FC=()=>{
 const {currentUser,setActiveTab}=usePOS();
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [yearly,setYearly]=useState(true),[extras,setExtras]=useState(0),[quote,setQuote]=useState<any>(null);
 const load=async()=>{setLoading(true);setError('');try{const s=await billingRequest('status');setData(s);setExtras(s.outlets.extra);window.dispatchEvent(new Event('subscription-updated'));}catch(e:any){setError(e.message);}finally{setLoading(false);}};
 useEffect(()=>{let active=true;setLoading(true);billingRequest('status').then(s=>{if(active){setData(s);setExtras(s.outlets.extra);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[currentUser.id]);
 const preview=async(planId:string)=>{setBusy(true);setError('');try{setQuote({...await billingRequest('prorated-upgrade',{planId,billingCycle:yearly?'YEARLY':'MONTHLY',extraOutlets:extras}),requestKey:crypto.randomUUID()});}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 const pay=async()=>{setBusy(true);setError('');try{
   const result=await billingRequest('checkout',{planId:quote.planId,billingCycle:quote.billingCycle,extraOutlets:quote.extraOutlets,requestKey:quote.requestKey});
   if(!result.paymentUrl || !result.paymentUrl.startsWith('https://'))throw new Error('URL pembayaran tidak valid');
   window.location.assign(result.paymentUrl);
  }catch(e:any){setError(e.message);setBusy(false);}
 };
 return <div className="space-y-6">
  <section className="rounded-3xl bg-slate-900 text-white p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Langganan & outlet</h2>
      <div className="flex items-center gap-3">
        <button onClick={()=>setActiveTab('payment')} className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs cursor-pointer shadow-sm">Buka Halaman Pembayaran &rarr;</button>
        <button disabled={loading} onClick={load} className="underline text-xs">Muat ulang status</button>
      </div>
    </div>
   {loading?<p className="mt-4">Memeriksa langganan…</p>:data?<div className="grid sm:grid-cols-3 gap-5 mt-5">
    <div><p className="text-slate-400 text-xs">PAKET</p><p className="font-bold">{data.plan?.name}</p><p>{data.subscription.billingCycle}</p></div>
    <div><p className="text-slate-400 text-xs">AKSES</p><p>{data.subscription.status} · {data.accessMode}</p><p>{data.daysLeft} hari tersisa</p><small>Berakhir {formatDateTime(data.subscription.currentPeriodEnd)}</small></div>
    <div><p className="text-slate-400 text-xs">OUTLET AKTIF</p><p className="text-2xl font-bold">{data.outlets.used} / {data.outlets.limit}</p><small>{data.outlets.included} termasuk + {data.outlets.extra} add-on</small></div>
   </div>:<p className="mt-4">Status belum dapat diverifikasi. Tidak ada trial atau pembayaran yang dianggap aktif tanpa data server.</p>}
  </section>
  {error&&<div role="alert" className="p-4 rounded-xl bg-red-50 text-red-800 border border-red-200">{error}</div>}
  {data?.accessMode!=='FULL'&&data&&<p className="p-4 rounded-xl bg-amber-50 text-amber-900">Masa aktif berakhir. Transaksi dan perubahan data dibatasi. Data masih bisa diekspor; lanjutkan paket melalui pembayaran terverifikasi.</p>}
  <section className="rounded-2xl bg-white border p-5 space-y-4">
   <h3 className="font-bold">Pilih paket & jumlah outlet</h3>
   <div className="flex flex-wrap items-center gap-4">
    <label>Periode <select aria-label="Periode langganan" value={yearly?'YEARLY':'MONTHLY'} onChange={e=>{setYearly(e.target.value==='YEARLY');setQuote(null);}} className="border p-2 rounded ml-2"><option value="MONTHLY">Bulanan</option><option value="YEARLY">Tahunan</option></select></label>
    <label>Tambahan outlet <input aria-label="Jumlah tambahan outlet" type="number" min="0" max="100" value={extras} onChange={e=>{setExtras(Number(e.target.value));setQuote(null);}} className="border rounded p-2 w-24 ml-2"/></label>
   </div>
   <p className="text-sm text-slate-500">Add-on 80% harga Plus: Rp79.200/outlet/bulan, atau Rp760.320/outlet/tahun. Kapasitas bertambah setelah pembayaran terverifikasi.</p>
   <div className="grid md:grid-cols-2 gap-4">{PAID_SAAS_PLANS.map(p=><div key={p.id} className="border rounded-2xl p-5 space-y-3">
    <h4 className="font-bold text-lg">{p.name} · {p.maxOutlets} outlet</h4><p className="text-2xl font-bold">{formatRupiah(yearly?annualTotal(p):p.priceIdr)}<span className="text-sm">/{yearly?'tahun':'bulan'}</span></p>
    <ul className="text-sm space-y-2">{p.features.map(f=><li key={f}>✓ {f}</li>)}</ul>
    <button disabled={busy||!data} onClick={()=>preview(p.id)} className="bg-amber-500 rounded-xl p-3 font-bold w-full disabled:opacity-50">Hitung tagihan / ubah paket</button>
   </div>)}</div>
  </section>
  {quote&&<section className="border rounded-2xl bg-amber-50 p-5 space-y-3" aria-label="Konfirmasi tagihan">
   <h3 className="font-bold">{quote.planName} · {quote.billingCycle} · {quote.extraOutlets} add-on</h3>
   <p>Harga periode: {formatRupiah(quote.recurringAmount)} − kredit masa aktif: {formatRupiah(quote.unusedCredit)}</p>
   <p className="text-xl font-bold">Total bayar: {formatRupiah(quote.amount)}</p>
   <p className="text-sm">Periode {formatDateTime(quote.periodStart)} — {formatDateTime(quote.periodEnd)}</p>
   <p className="text-xs text-slate-600">Checkout menghitung ulang nominal jika waktu berubah. Kembali dari halaman pembayaran tidak otomatis berarti lunas.</p>
   <button disabled={busy} onClick={pay} className="bg-slate-900 text-white px-5 py-3 rounded-xl disabled:opacity-50">{busy?'Memproses…':'Lanjut pembayaran DOKU'}</button>
   <button disabled={busy} onClick={()=>setQuote(null)} className="ml-4">Batal</button>
  </section>}
  <section className="rounded-2xl border bg-white p-5 overflow-x-auto"><h3 className="font-bold mb-4">Riwayat tagihan</h3>
   <table className="w-full text-sm text-left"><thead><tr><th>Invoice</th><th>Paket / periode</th><th>Total</th><th>Status</th></tr></thead>
    <tbody>{data?.invoices.map((i:any)=><tr key={i.id} className="border-t"><td className="py-3">{i.invoiceNumber || i.id}</td><td>{i.planName} · {i.billingCycle || 'legacy'}</td><td>{formatRupiah(i.amount)}</td><td>{i.paymentStatus} / {i.reconciliationStatus}{i.paymentLinkUrl&&i.paymentStatus!=='PAID'&&<a href={i.paymentLinkUrl} className="block underline" target="_blank" rel="noreferrer">Buka tagihan</a>}</td></tr>)}</tbody>
   </table>{data&&!data.invoices.length&&<p className="text-sm text-slate-500 py-4">Belum ada tagihan.</p>}
  </section>
 </div>;
};
