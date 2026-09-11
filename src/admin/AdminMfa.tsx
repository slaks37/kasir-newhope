import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { api, type Session } from './api';
import { AuthLayout } from '../components/auth/AuthLayout';

export default function AdminMfa({onVerified,onLogout}:{onVerified:(session:Session)=>void;onLogout:()=>void}) {
  const [factorId,setFactorId]=useState('');
  const [factors,setFactors]=useState<{id:string;friendly_name?:string}[]>([]);
  const [qr,setQr]=useState(''),[secret,setSecret]=useState(''),[code,setCode]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [canEnroll,setCanEnroll]=useState(false);
  useEffect(()=>{
    let active=true;
    supabase.auth.mfa.listFactors().then(({data,error})=>{
      if(!active)return;
      if(error){setError(error.message);return;}
      setFactors(data.totp);setFactorId(data.totp[0]?.id || '');
      setCanEnroll(data.totp.length===0);
    }).catch(()=>{if(active)setError('Tidak dapat membaca autentikator. Muat ulang untuk mencoba lagi.');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);
  const enroll=async()=>{
    if(busy || factorId || !canEnroll)return;
    setBusy(true);setError('');
    try{
      const {data,error}=await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'New Hope Admin '+Date.now()});
      if(error)throw error;
      setFactorId(data.id);setQr(data.totp.qr_code);setSecret(data.totp.secret);
    }catch(err){setError((err as Error).message);}finally{setBusy(false);}
  };
  const verify=async(e:React.FormEvent)=>{
    e.preventDefault();if(busy || !factorId)return;
    setBusy(true);setError('');
    try{
      const {error}=await supabase.auth.mfa.challengeAndVerify({factorId,code});
      if(error)throw error;
      const session=await api.me();
      if(session.mfaRequired)throw new Error('Sesi belum terverifikasi. Coba kode terbaru.');
      setSecret('');setQr('');setCode('');onVerified(session);
    }catch(err){setCode('');setError((err as Error).message);}finally{setBusy(false);}
  };
  return <AuthLayout admin><h1 className="text-2xl font-bold">Verifikasi autentikator admin</h1>
    <p className="my-4">Akses admin memerlukan MFA. Tindakan perubahan memerlukan kode yang diverifikasi dalam 10 menit terakhir. Tindakan sebelumnya tidak dikirim ulang otomatis.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {loading ? <p role="status">Memeriksa autentikator…</p> : <>
      {!factorId && canEnroll && <button disabled={busy} onClick={enroll} className="nh-auth-submit">Aktifkan aplikasi autentikator</button>}
      {qr && <div className="my-4"><img src={qr.startsWith('data:')?qr:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr)} alt="QR untuk aplikasi autentikator pribadi Anda" width={200} height={200}/>
        <p>Jika QR tidak terbaca, masukkan kunci ini secara manual. Jangan bagikan:</p><code className="break-all">{secret}</code></div>}
      {factorId && <form onSubmit={verify} className="space-y-4 my-4">
        {factors.length>1 && <label>Autentikator<select disabled={busy} value={factorId} onChange={e=>setFactorId(e.target.value)}>{factors.map(f=><option key={f.id} value={f.id}>{f.friendly_name || f.id}</option>)}</select></label>}
        <label className="block" htmlFor="admin-totp">Kode 6 digit</label>
        <input id="admin-totp" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} className="nh-input"/>
        <button className="nh-auth-submit" disabled={busy || code.length!==6}>{busy?'Memverifikasi…':'Verifikasi'}</button>
      </form>}
    </>}
    <p className="text-sm my-4">Kehilangan autentikator? Hubungi operator untuk pemulihan identitas; tidak tersedia bypass MFA di aplikasi.</p>
    <button disabled={busy} onClick={async()=>{try{await api.logout();onLogout();}catch{setError('Logout gagal. Coba kembali.');}}}>Keluar</button>
  </AuthLayout>;
}
