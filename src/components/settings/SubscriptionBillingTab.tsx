import React,{useEffect,useState} from 'react';
import {PAID_SAAS_PLANS,annualTotal} from '../../config/saasPlans';
import {formatRupiah,formatDateTime} from '../../utils/formatters';
import {usePOS} from '../../context/POSContext';
import {useAuth} from '../../context/AuthContext';

async function billingRequest(path:string,body?:any,token?:string){
 const headers: Record<string, string> = {'Content-Type':'application/json'};
 if (token) headers['Authorization'] = `Bearer ${token}`;
 const r=await fetch('/api/v1/subscription/'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
 const data=await r.json();if(!r.ok || !data.ok)throw new Error(data.error || 'Permintaan billing gagal');return data;
}
export const SubscriptionBillingTab:React.FC=()=>{
 const {currentUser,setActiveTab}=usePOS();
 const {session}=useAuth();
 const token = session?.access_token;
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [yearly,setYearly]=useState(true),[extras,setExtras]=useState(0),[quote,setQuote]=useState<any>(null);
 const load=async()=>{setLoading(true);setError('');try{const s=await billingRequest('status',undefined,token);setData(s);setExtras(s.outlets.extra);window.dispatchEvent(new Event('subscription-updated'));}catch(e:any){setError(e.message);}finally{setLoading(false);}};
 useEffect(()=>{let active=true;setLoading(true);billingRequest('status',undefined,token).then(s=>{if(active){setData(s);setExtras(s.outlets.extra);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[currentUser.id,token]);
 const preview=async(planId:string)=>{setBusy(true);setError('');try{setQuote({...await billingRequest('prorated-upgrade',{planId,billingCycle:yearly?'YEARLY':'MONTHLY',extraOutlets:extras},token),requestKey:crypto.randomUUID()});}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 const pay=async()=>{setBusy(true);setError('');try{
   const result=await billingRequest('checkout',{planId:quote.planId,billingCycle:quote.billingCycle,extraOutlets:quote.extraOutlets,requestKey:quote.requestKey},token);
   if(!result.paymentUrl || !result.paymentUrl.startsWith('https://'))throw new Error('URL pembayaran tidak valid');
   window.location.assign(result.paymentUrl);
  }catch(e:any){setError(e.message);setBusy(false);}
 };
 return <div className="space-y-6">
  <section className="rounded-3xl bg-white border border-slate-200 text-slate-900 p-6 shadow-xs">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold text-slate-900">Langganan & outlet</h2>
      <div className="flex items-center gap-3">
        <button onClick={()=>setActiveTab('payment')} className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs cursor-pointer shadow-xs">Buka Halaman Pembayaran &rarr;</button>
        <button disabled={loading} onClick={load} className="underline text-xs text-slate-600 hover:text-slate-900">Muat ulang status</button>
      </div>
    </div>
   {loading?<p className="mt-4 text-slate-600">Memeriksa langganan…</p>:data?<div className="space-y-4 mt-5">
    <div className="grid sm:grid-cols-4 gap-4">
      <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
        <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Paket Aktif</p>
        <p className="font-bold text-base text-slate-900 mt-1">{data.plan?.name}</p>
        <p className="text-xs text-slate-600">{data.subscription.status==='FREE'?'Gratis selamanya':data.subscription.billingCycle === 'YEARLY' ? 'Siklus Tahunan' : 'Siklus Bulanan'}</p>
        {data.subscription.status === 'TRIAL' && (
          <span className="inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
            Trial 45 Hari (1x Pakai)
          </span>
        )}
      </div>
      <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
        <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Durasi Masa Aktif</p>
        <p className="font-bold text-base text-slate-900 mt-1">{data.subscription.status==='FREE'?'Tanpa batas waktu':`Hari ke-${data.activeDays} / ${data.totalPeriodDays} hari`}</p>
        <p className="text-xs text-amber-700 font-medium">{data.subscription.status==='FREE'?'10 produk · 1 cabang · owner saja':`${data.daysLeft} hari tersisa`}</p>
      </div>
      <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
        <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Jatuh Tempo Perpanjangan</p>
        <p className="font-bold text-sm text-slate-900 mt-1">{data.subscription.status==='FREE'?'Tidak ada tagihan':formatDateTime(data.renewalDueDate || data.subscription.currentPeriodEnd)}</p>
        <p className={`text-xs font-semibold mt-1 ${data.requiresRenewal ? 'text-red-600' : 'text-emerald-700'}`}>
          {data.requiresRenewal ? '⚠️ Perlu Diperpanjang' : '✓ Status Aktif Normal'}
        </p>
      </div>
      <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
        <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider">Outlet Aktif</p>
        <p className="text-xl font-bold text-slate-900 mt-1">{data.outlets.used} / {data.outlets.limit}</p>
        <p className="text-xs text-slate-500">{data.outlets.included} bawaan + {data.outlets.extra} add-on</p>
      </div>
    </div>
    {data.requiresRenewal && (
      <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between gap-3 text-xs text-amber-900">
        <div>
          <span className="font-bold text-amber-800">Waktunya Perpanjang Langganan: </span>
          <span>{data.daysLeft > 0 ? `Tersisa ${data.daysLeft} hari sebelum sistem beralih ke mode hanya baca.` : 'Masa aktif telah habis. Segera perpanjang agar operasional kasir tidak terhenti.'}</span>
        </div>
        <button onClick={()=>setActiveTab('payment')} className="whitespace-nowrap px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition-colors cursor-pointer shadow-xs">
          Perpanjang Sekarang
        </button>
      </div>
    )}
   </div>:<p className="mt-4 text-slate-600">Status belum dapat diverifikasi. Tidak ada trial atau pembayaran yang dianggap aktif tanpa data server.</p>}
  </section>
  {error&&<div role="alert" className="p-4 rounded-xl bg-red-50 text-red-800 border border-red-200">{error}</div>}
  {data?.accessMode!=='FULL'&&data&&<p className="p-4 rounded-xl bg-amber-50 text-amber-900">Masa aktif berakhir. Transaksi dan perubahan data dibatasi. Data masih bisa diekspor; lanjutkan paket melalui pembayaran terverifikasi.</p>}
  <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4 shadow-xs">
   <h3 className="font-bold text-slate-900">Pilih paket & jumlah outlet</h3>
   <div className="flex flex-wrap items-center gap-4">
    <label className="text-slate-700 text-sm">Periode <select aria-label="Periode langganan" value={yearly?'YEARLY':'MONTHLY'} onChange={e=>{setYearly(e.target.value==='YEARLY');setQuote(null);}} className="border border-slate-300 p-2 rounded-xl ml-2"><option value="MONTHLY">Bulanan</option><option value="YEARLY">Tahunan</option></select></label>
    <label className="text-slate-700 text-sm">Tambahan outlet <input aria-label="Jumlah tambahan outlet" type="number" min="0" max="100" value={extras} onChange={e=>{setExtras(Number(e.target.value));setQuote(null);}} className="border border-slate-300 rounded-xl p-2 w-24 ml-2"/></label>
   </div>
   <p className="text-sm text-slate-500">Add-on 80% harga Plus: Rp79.200/outlet/bulan, atau Rp760.320/outlet/tahun. Kapasitas bertambah setelah pembayaran terverifikasi.</p>
   <div className="grid md:grid-cols-2 gap-4">{PAID_SAAS_PLANS.map(p=><div key={p.id} className="border border-slate-200 rounded-2xl p-5 space-y-3 bg-slate-50/50">
    <h4 className="font-bold text-lg text-slate-900">{p.name} · {p.maxOutlets} outlet</h4><p className="text-2xl font-bold text-slate-900">{formatRupiah(yearly?annualTotal(p):p.priceIdr)}<span className="text-sm text-slate-500">/{yearly?'tahun':'bulan'}</span></p>
    <ul className="text-sm space-y-2 text-slate-700">{p.features.map(f=><li key={f}>✓ {f}</li>)}</ul>
    <button disabled={busy||!data} onClick={()=>preview(p.id)} className="bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl p-3 font-bold w-full disabled:opacity-50 shadow-xs cursor-pointer">Hitung tagihan / ubah paket</button>
   </div>)}</div>
  </section>
  {quote&&<section className="border border-amber-200 rounded-2xl bg-amber-50 p-5 space-y-3" aria-label="Konfirmasi tagihan">
   <h3 className="font-bold text-slate-900">{quote.planName} · {quote.billingCycle} · {quote.extraOutlets} add-on</h3>
   <p className="text-slate-700">Harga periode: {formatRupiah(quote.recurringAmount)} − kredit masa aktif: {formatRupiah(quote.unusedCredit)}</p>
   <p className="text-xl font-bold text-slate-900">Total bayar: {formatRupiah(quote.amount)}</p>
   <p className="text-sm text-slate-600">Periode {formatDateTime(quote.periodStart)} — {formatDateTime(quote.periodEnd)}</p>
   <p className="text-xs text-slate-600">Checkout menghitung ulang nominal jika waktu berubah. Kembali dari halaman pembayaran tidak otomatis berarti lunas.</p>
   <button disabled={busy} onClick={pay} className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-5 py-3 rounded-xl disabled:opacity-50 shadow-xs cursor-pointer">{busy?'Memproses…':'Lanjut pembayaran DOKU'}</button>
   <button disabled={busy} onClick={()=>setQuote(null)} className="ml-4 text-slate-600 hover:text-slate-900 underline text-sm cursor-pointer">Batal</button>
  </section>}
  <section className="rounded-2xl border bg-white p-5 overflow-x-auto"><h3 className="font-bold mb-4">Riwayat tagihan</h3>
   <table className="w-full text-sm text-left"><thead><tr><th>Invoice</th><th>Paket / periode</th><th>Total</th><th>Status</th></tr></thead>
    <tbody>{data?.invoices.map((i:any)=><tr key={i.id} className="border-t"><td className="py-3">{i.invoiceNumber || i.id}</td><td>{i.planName} · {i.billingCycle || 'legacy'}</td><td>{formatRupiah(i.amount)}</td><td>{i.paymentStatus} / {i.reconciliationStatus}{i.paymentLinkUrl&&i.paymentStatus!=='PAID'&&<a href={i.paymentLinkUrl} className="block underline" target="_blank" rel="noreferrer">Buka tagihan</a>}</td></tr>)}</tbody>
   </table>{data&&!data.invoices.length&&<p className="text-sm text-slate-500 py-4">Belum ada tagihan.</p>}
  </section>
 </div>;
};
