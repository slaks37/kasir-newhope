import React from 'react';
import {usePOSFields} from '../../context/POSDomains';
import {formatRupiah} from '../../utils/formatters';
export function PaymentReconciliationSummary(){
 const {settings,activeBranch}=usePOSFields(['settings','activeBranch']);
 const [data,setData]=React.useState<any>(null),[error,setError]=React.useState(''),[refresh,setRefresh]=React.useState(0);
 React.useEffect(()=>{let alive=true;setData(null);setError('');if(!activeBranch?.id)return;
  const q=new URLSearchParams({sector:settings.businessSector||'FNB',outletId:activeBranch.id});
  void fetch('/api/v1/finance/reconciliation?'+q,{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(async r=>{const d=await r.json();if(!r.ok||!d.ok)throw new Error('Rekonsiliasi server belum tersedia.');if(alive)setData(d);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};
 },[settings.businessSector,activeBranch?.id,refresh]);
 const labels:Record<string,string>={CASHIER_RECORDED:'Dicatat kasir',PROVIDER_VERIFIED:'Diverifikasi penyedia',LEGACY_UNVERIFIED:'Historis belum diverifikasi'};
 return <section className="rounded-2xl border bg-white p-4 space-y-3">
  <h2 className="font-bold">Asal verifikasi pembayaran</h2>
  <p className="text-sm">Status lunas di POS dapat berasal dari pencatatan kasir. Konfirmasi penyedia dan pencairan dana diperiksa terpisah; QRIS statis tidak dicocokkan hanya dari nominal. Ringkasan seluruh periode untuk outlet ini.</p>
  {error?<p role="alert">{error}</p>:!data?<p role="status">Memuat sumber pembayaran…</p>:<><ul>{data.totals.map((r:any)=><li key={r.verification_origin}>{labels[r.verification_origin]||r.verification_origin}: {r.count} pembayaran · {formatRupiah(Number(r.amount))}</li>)}</ul>{data.exceptions.length>0&&<p role="status">{data.exceptions.length} pengecualian rekonsiliasi terbaru memerlukan review pemilik: {data.exceptions.map((r:any)=>r.reason).join(', ')}</p>}</>}
  <button onClick={()=>setRefresh(n=>n+1)} className="rounded border px-3 py-1 text-sm">Muat ulang</button>
 </section>;
}
