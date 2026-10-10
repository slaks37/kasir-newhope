import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

type Overview = {
  endpoint: string;
  connections: {id:string;created_at:string;expires_at:string;revoked_at:string|null}[];
  events: {event:string;tool:string|null;slug:string|null;created_at:string}[];
};
async function request(path:string,body?:unknown,signal?:AbortSignal) {
  const { data }=await supabase.auth.getSession();
  if (!data.session) throw new Error('Masuk kembali sebagai Superadmin.');
  const r=await fetch('/api/blog-mcp/'+path,{method:body?'POST':'GET',signal,
    headers:{Authorization:'Bearer '+data.session.access_token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const result=await r.json();
  if (!r.ok) {
    if (['MFA_REQUIRED','REAUTH_REQUIRED'].includes(result.error)) {
      window.dispatchEvent(new Event('admin-mfa-required'));
      throw new Error('Verifikasi autentikator, lalu tinjau dan kirim kembali persetujuan.');
    }
    throw new Error(result.error==='access_denied'?'Hanya Superadmin aktif yang dapat memberi izin editorial.':result.error||'Koneksi belum berhasil.');
  }
  return result;
}
const button='rounded-xl bg-amber-400 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50';
export default function BlogConnections({consent=false}:{consent?:boolean}) {
  const [data,setData]=useState<Overview|null>(null),[error,setError]=useState('');
  const [approved,setApproved]=useState(false),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  const [revoke,setRevoke]=useState<string|null>(null);
  const params=new URLSearchParams(window.location.search);
  const valid=params.get('client_id')==='newhope-blog-chatgpt';
  useEffect(()=>{
    const controller=new AbortController(); setError('');
    request('manage',undefined,controller.signal).then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[revision]);
  async function decide(approve:boolean) {
    setBusy(true);setError('');
    try {
      const result=await request('consent',{...Object.fromEntries(params),approve});
      // The server validates callback, state, resource and PKCE before returning this URL.
      window.location.assign(result.redirect);
    } catch(e) {setError(e instanceof Error?e.message:'Koneksi gagal.');setBusy(false);}
  }
  async function disconnect() {
    setBusy(true);setError('');
    try {await request('disconnect',{id:revoke});setRevoke(null);setRevision(n=>n+1);}
    catch(e){setError(e instanceof Error?e.message:'Pencabutan gagal.');}
    finally{setBusy(false);}
  }
  return <main className="min-h-screen bg-slate-50 p-5 text-slate-900 sm:p-8">
    <div className="mx-auto max-w-2xl space-y-5">
      <a className="text-sm text-amber-800 underline" href="/admin">Kembali ke admin New Hope</a>
      <header><p className="text-xs font-bold uppercase tracking-widest text-amber-700">Editorial New Hope</p>
        <h1 className="mt-2 text-3xl font-extrabold">{consent?'Hubungkan ChatGPT ke blog':'Koneksi ChatGPT Blog'}</h1>
        <p className="mt-2 text-slate-600">Kelola artikel melalui chat dengan izin editorial Superadmin.</p></header>
      {error&&<div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4">{error}<button className="ml-3 underline" onClick={()=>setRevision(n=>n+1)}>Muat ulang</button></div>}
      {!data&&!error?<p role="status">Memeriksa izin editorial…</p>:data?<>
        <section className="space-y-4 rounded-2xl border bg-white p-6">
          {consent?<>
            <h2 className="text-lg font-bold">Tinjau izin ChatGPT</h2>
            {!valid&&<p role="alert">Permintaan koneksi tidak dikenal. Mulai kembali dari pengaturan aplikasi ChatGPT.</p>}
            <p>ChatGPT dapat membaca artikel dan draft, memvalidasi tulisan, membuat dan memperbarui artikel, serta menarik artikel dari publik. Isi blog yang dibaca akan diterima ChatGPT.</p>
            <p>Tulisan disimpan sebagai draft secara default. Untuk menerbitkan, berikan perintah publikasi secara eksplisit di chat. Izin berlaku 3 tahun dan dapat dicabut kapan saja.</p>
            <label className="flex items-start gap-3"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)} className="mt-1"/>Saya mengizinkan ChatGPT mengelola blog New Hope dengan izin tersebut.</label>
            <div className="flex flex-wrap gap-3"><button className={button} disabled={busy||!approved||!valid} onClick={()=>void decide(true)}>{busy?'Memproses…':'Izinkan akses blog'}</button><button className="rounded-xl border px-4 py-3" disabled={busy||!valid} onClick={()=>void decide(false)}>Tolak</button></div>
          </>:<>
            <h2 className="text-lg font-bold">Hubungkan dari ChatGPT</h2>
            <p>Tambahkan aplikasi MCP khusus dengan alamat berikut dan autentikasi OAuth, lalu tinjau persetujuan editorial di New Hope.</p>
            <code className="block break-all rounded-xl border bg-slate-50 p-3">{data.endpoint}</code>
            <p className="text-sm text-slate-600">Ketersediaan aplikasi khusus mengikuti pengaturan akun dan workspace ChatGPT.</p>
          </>}
        </section>
        <section className="space-y-4 rounded-2xl border bg-white p-6"><h2 className="text-lg font-bold">Koneksi yang diizinkan</h2>
          {!data.connections.length&&<p>Belum ada koneksi ChatGPT Blog.</p>}
          {data.connections.map(c=><div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <p>ChatGPT Blog · {c.revoked_at?'Dicabut':Date.parse(c.expires_at)<=Date.now()?'Kedaluwarsa':'Berlaku sampai '+new Date(c.expires_at).toLocaleDateString('id-ID')}</p>
            {!c.revoked_at&&Date.parse(c.expires_at)>Date.now()&&<button className="text-rose-700 underline" disabled={busy} onClick={()=>setRevoke(c.id)}>Cabut akses</button>}
          </div>)}
          {revoke&&<div className="space-y-3 rounded-xl bg-amber-50 p-4"><p>Cabut akses koneksi ini? ChatGPT tidak dapat lagi mengelola blog melalui koneksi tersebut.</p><button className={button} disabled={busy} onClick={()=>void disconnect()}>Konfirmasi pencabutan</button> <button disabled={busy} onClick={()=>setRevoke(null)}>Batal</button></div>}
        </section>
        <section className="space-y-3 rounded-2xl border bg-white p-6"><h2 className="text-lg font-bold">Aktivitas editorial</h2>
          {!data.events.length?<p>Belum ada aktivitas.</p>:<ul className="space-y-2 text-sm">{data.events.map((e,i)=><li key={i}>{new Date(e.created_at).toLocaleString('id-ID')} · {e.event}{e.tool?' · '+e.tool:''}{e.slug?' · '+e.slug:''}</li>)}</ul>}
        </section>
      </>:null}
    </div>
  </main>;
}
