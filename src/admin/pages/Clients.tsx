import {useEffect,useRef,useState,type FormEvent} from 'react';
import {api,waktu} from '../api';
import {Card,ErrorBox,Loading,Pagination,SearchBox,Table,Th,Td} from '../ui';
import SidePanel from '../SidePanel';
import {acknowledgeReset,pendingResetKey} from '../resetIntent';

const button='bg-amber-400 text-slate-900 rounded-lg px-4 py-2 font-semibold disabled:opacity-50';
const input='border border-slate-300 rounded-lg p-2 w-full';

function ClientPanel({row,onClose,onChanged,onSubscriptions}:{row:any;onClose:()=>void;onChanged:()=>void;onSubscriptions:()=>void}) {
  const [reason,setReason]=useState(''),[ticket,setTicket]=useState('');
  const [data,setData]=useState<any>(null),[name,setName]=useState('');
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false);
  const resetKey=useRef<string|null>(null),generation=useRef(0),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
  const load=async(why:string)=>{
    const version=++generation.current;setBusy(true);setError('');
    try{const result=await api.client(row.id,why);if(alive.current&&version===generation.current){setData(result);setName(result.client.name);setTicket(why);}}
    catch(e:any){if(alive.current&&version===generation.current)setError(e.message);}
    finally{if(alive.current&&version===generation.current)setBusy(false);}
  };
  const act=async(action:string)=>{
    if(busy||reason.trim().length<10)return;
    setBusy(true);setError('');setMessage('');
    try{
      const emailAction=action==='RESET_PASSWORD'||action==='RESEND_CONFIRMATION';
      const intentScope=action==='RESEND_CONFIRMATION'?row.id+':confirmation':row.id;
      if(emailAction)resetKey.current=pendingResetKey(sessionStorage,intentScope);
      const result=await api.clientAction(row.id,{action,reason:reason.trim(),name,requestKey:emailAction?resetKey.current:undefined});
      if(!alive.current)return;
      setMessage(result.message);
      // Keep an uncertain intent key after a lost ACK. A retry checks its
      // recorded outcome, never sends another email with that key.
      if(emailAction&&result.status==='SENT'){acknowledgeReset(sessionStorage,intentScope);resetKey.current=null;setConfirmed(false);}
      if(emailAction&&result.status==='FAILED'){acknowledgeReset(sessionStorage,intentScope);resetKey.current=null;setConfirmed(false);setError('Permintaan sebelumnya gagal. Periksa riwayat sebelum mencoba permintaan baru.');}
      onChanged();
      const resultDetail=await api.client(row.id,ticket);
      if(alive.current){setData(resultDetail);setName(resultDetail.client.name);}
    }catch(e:any){if(alive.current)setError(e.message);}
    finally{if(alive.current)setBusy(false);}
  };
  return <SidePanel title={'Customer & Support · '+(data?.client.name||row.name)} onClose={onClose} busy={busy}>
    <p className="text-sm text-slate-500">Kelola akun pelanggan SaaS, bukan pelanggan belanja toko. Akses detail dan tindakan dicatat dalam audit.</p>
    {error&&<ErrorBox error={{message:error}}/>}{message&&<p role="status" className="p-3 rounded-lg bg-emerald-50 text-emerald-900">{message}</p>}
    <form className="space-y-2" onSubmit={(e:FormEvent)=>{e.preventDefault();void load(reason.trim());}}>
      <label className="block">Alasan bantuan / nomor tiket (minimal 10 karakter)<textarea className={input} value={reason} onChange={e=>setReason(e.target.value)} required minLength={10} maxLength={2000} disabled={busy}/></label>
      <button className={button} disabled={busy||reason.trim().length<10}>{data?'Muat ulang detail':'Buka detail akun'}</button>
    </form>
    {busy&&<Loading/>}
    {data&&<fieldset disabled={busy} className="space-y-5">
      <section className="space-y-2"><h3 className="font-bold">Akun owner</h3>
        <p>{data.client.name} · {data.client.is_active?'Aktif':'Nonaktif'}<br/><small className="break-all">ID akun: {row.id}</small></p>
        <p>Email akun: {data.client.ownerEmail||'Belum tersedia'}<br/><small>Status Auth: {data.client.authStatus}</small></p>
        {data.canEditProfile&&<form onSubmit={e=>{e.preventDefault();void act('UPDATE_CLIENT_PROFILE');}} className="space-y-2">
          <label className="block">Nama akun SaaS<input className={input} required minLength={2} maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label>
          <button className={button} disabled={reason.trim().length<10}>Simpan nama akun</button><p className="text-xs text-slate-500">Tidak mengubah email login, nama outlet, atau transaksi.</p>
        </form>}
      </section>
      <section className="space-y-2"><h3 className="font-bold">Reset password</h3>
        <p className="text-sm">Link dikirim hanya ke email owner terverifikasi di atas. Owner memilih password sendiri; admin tidak dapat melihat password. Memerlukan autentikator admin yang baru diverifikasi.</p>
        {!data.resetAvailable&&<p className="text-amber-800">{{EMAIL_UNCONFIRMED:'Email owner belum dikonfirmasi. Kirim ulang konfirmasi, lalu minta owner membuka link terbaru. Setelah terverifikasi, muat ulang detail untuk mengirim reset.',NOT_CONFIGURED:'Konfigurasi Auth server belum lengkap: administrator deployment perlu memasang SUPABASE_SERVICE_ROLE_KEY di server Vercel, bukan di browser.',UNAVAILABLE:'Layanan Auth gagal memeriksa akun. Coba muat ulang detail; jangan mengganti email atau password secara paksa.',OWNER_NOT_FOUND:'Akun owner tidak ditemukan atau tidak dapat dipulihkan. Periksa hubungan akun Auth dengan tenant.',OWNER_NOT_VERIFIED:'Akun owner belum terverifikasi.'}[data.client.authStatus as string]||'Reset belum tersedia. Periksa status Auth akun.'}</p>}
        <label className="flex gap-2 items-start"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Saya telah memverifikasi permintaan bantuan owner dan email tujuan.</label>
        <button type="button" className={button} disabled={!data.resetAvailable||!confirmed||reason.trim().length<10} onClick={()=>void act('RESET_PASSWORD')}>{resetKey.current?'Periksa permintaan reset sebelumnya':'Kirim email reset password'}</button>
        {data.confirmationAvailable&&<button type="button" className={button} disabled={!confirmed||reason.trim().length<10} onClick={()=>void act('RESEND_CONFIRMATION')}>Kirim ulang konfirmasi email</button>}
      </section>
      <section className="space-y-2"><h3 className="font-bold">Diagnosis cloud</h3>
        <p>{data.diagnostics.ledger_records} catatan transaksi di server<br/>Transaksi terakhir: {waktu(data.diagnostics.last_transaction_at)}</p>
        <p className="text-xs text-slate-500">Antrean offline perangkat tidak dapat diperiksa dari admin ini. Angka server bukan bukti bahwa semua perangkat selesai sinkron.</p>
        <h4 className="font-semibold">Unit usaha & outlet</h4>
        {data.businesses.map((b:any)=><p key={b.id}>{b.name} · {b.business_sector} · {b.is_active?'Aktif':'Nonaktif'}</p>)}
        {data.outlets.map((o:any)=><p key={o.id} className="text-sm">Outlet: {o.name} · {o.is_active?'Aktif':'Ditunda / nonaktif'}</p>)}
        {!data.businesses.length&&<p>Belum ada unit usaha.</p>}
        <button type="button" className="underline" onClick={onSubscriptions}>Kelola langganan & kapasitas outlet</button>
      </section>
      <section className="space-y-2"><h3 className="font-bold">Catatan bantuan</h3><p className="text-sm">Simpan alasan / nomor tiket di atas sebagai catatan support.</p><button type="button" className={button} disabled={reason.trim().length<10} onClick={()=>void act('NOTE')}>Simpan catatan support</button></section>
      <section><h3 className="font-bold">Riwayat support</h3>{data.history.length?data.history.map((h:any)=><div className="border-t py-3 text-sm" key={h.id}><p>{waktu(h.created_at)} · {h.action}</p><p>{h.operator_email} · {h.reason}</p></div>):<p>Belum ada tindakan support.</p>}</section>
      {Object.entries(data.truncated).filter(([,v])=>v).map(([key])=><p className="text-amber-800 text-sm" key={key}>Daftar {key} dibatasi; bukan seluruh riwayat.</p>)}
    </fieldset>}
  </SidePanel>;
}

export default function Clients({onSubscriptions}:{onSubscriptions:()=>void}) {
  const [search,setSearch]=useState(''),[offset,setOffset]=useState(0),[version,setVersion]=useState(0);
  const [data,setData]=useState<any>(null),[selected,setSelected]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;setLoading(true);setError('');api.clients({search,offset,limit:20}).then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[search,offset,version]);
  return <div className="space-y-4"><p className="text-slate-500">Bantuan akun owner: profil SaaS, reset password, diagnosis cloud, dan riwayat support. Data keuangan tidak dapat dihapus atau ditimpa dari sini.</p>
    {error&&<ErrorBox error={{message:error}}/>}<Card title="Customer & Support"><div className="p-4"><SearchBox value={search} onChange={v=>{setSearch(v);setOffset(0);}} placeholder="Cari nama akun / ID..."/></div>
      {loading?<Loading/>:data&&<><div className="overflow-x-auto"><Table><thead><tr><Th>Akun SaaS</Th><Th>Status</Th><Th>Unit usaha / outlet aktif</Th><Th>Aksi</Th></tr></thead><tbody>{data.rows.map((r:any)=><tr key={r.id}><Td>{r.name}<br/><small>{waktu(r.created_at)}</small></Td><Td>{r.is_active?'Aktif':'Nonaktif'}</Td><Td>{r.business_count} / {r.active_outlet_count}</Td><Td><button className="underline" onClick={()=>setSelected(r)}>Kelola & bantu</button></Td></tr>)}</tbody></Table></div>{!data.rows.length&&<p className="p-5">Tidak ada akun yang cocok.</p>}<Pagination offset={offset} total={data.total} limit={20} onChange={setOffset}/></>}
    </Card>{selected&&<ClientPanel key={selected.id} row={selected} onClose={()=>setSelected(null)} onChanged={()=>setVersion(v=>v+1)} onSubscriptions={()=>{setSelected(null);onSubscriptions();}}/>}
  </div>;
}
