import React from 'react';
export function PrivacyRequestsTab(){
 const [type,setType]=React.useState('ACCESS'),[message,setMessage]=React.useState(''),[notice,setNotice]=React.useState(''),[busy,setBusy]=React.useState(false),[requests,setRequests]=React.useState<any[]>([]);
 const pending=React.useRef<string|null>(null);
 const load=React.useCallback(async()=>{const r=await fetch('/api/v1/privacy/requests',{cache:'no-store'});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Permintaan belum tersedia');setRequests(d.requests);},[]);
 React.useEffect(()=>{void load().catch(e=>setNotice(e.message));},[load]);
 return <section className="rounded-xl border bg-white p-5 space-y-4">
  <h2 className="font-bold">Privasi & Permintaan Data</h2>
  <p><a href="/privacy" target="_blank" rel="noreferrer" className="underline">Pemberitahuan privasi</a> · <a href="/terms" target="_blank" rel="noreferrer" className="underline">Syarat layanan</a> · <a href="/support" target="_blank" rel="noreferrer" className="underline">Bantuan</a></p>
  <p className="text-sm">Permintaan dicatat untuk akun pemilik yang terverifikasi. Penghapusan/ekspor membutuhkan verifikasi dan tinjauan retensi; transaksi wajib dan audit tidak otomatis dihapus. Untuk data pelanggan/staf, jelaskan kewenangan Anda tanpa mengirim NIK, foto identitas, password atau data kartu.</p>
  <form className="space-y-3" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);pending.current||=crypto.randomUUID();try{
   const r=await fetch('/api/v1/privacy/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientRequestId:pending.current,type,message}),signal:AbortSignal.timeout(15000)}),d=await r.json();
   if(!r.ok||!d.ok)throw new Error(d.error||'Permintaan belum tercatat');setNotice('Permintaan tercatat: '+d.requestId);pending.current=null;setMessage('');await load();
  }catch(e){setNotice(e instanceof Error?e.message:'Permintaan belum tercatat');}finally{setBusy(false);}}}>
   <label className="block">Jenis permintaan<select disabled={busy} value={type} onChange={e=>{pending.current=null;setType(e.target.value);}} className="block border p-2 rounded">{[['ACCESS','Akses data'],['CORRECTION','Koreksi'],['DELETION','Penghapusan'],['EXPORT','Ekspor'],['CONSENT_WITHDRAWAL','Penarikan persetujuan']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
   <label className="block">Penjelasan singkat<textarea required disabled={busy} maxLength={1000} value={message} onChange={e=>{pending.current=null;setMessage(e.target.value);}} className="block border rounded p-2 w-full"/></label>
   <button disabled={busy} className="rounded bg-amber-400 text-slate-950 px-4 py-2 font-bold">{busy?'Mencatat…':'Ajukan permintaan'}</button>
  </form>
  {notice&&<p role="status">{notice}</p>}
  <ul className="space-y-2">{requests.map(r=><li key={r.id} className="rounded border p-3 text-sm">{r.request_type} · {r.status} · {new Date(r.created_at).toLocaleString('id-ID')}<br/>{r.id}</li>)}</ul>
 </section>;
}
