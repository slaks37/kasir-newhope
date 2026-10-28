import { useEffect, useState } from 'react';
import {authRuntime,isNeonAuth} from '../lib/authRuntime';
import { api, type Session } from './api';
import { AuthLayout } from '../components/auth/AuthLayout';

export default function AdminMfa({onVerified,onLogout,embedded=false}:{onVerified:(session:Session)=>void;onLogout:()=>void;embedded?:boolean}) {
  const [factorId,setFactorId]=useState('');
  const [factors,setFactors]=useState<{id:string;friendly_name?:string}[]>([]);
  const [qr,setQr]=useState(''),[secret,setSecret]=useState(''),[code,setCode]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [canEnroll,setCanEnroll]=useState(false);
  const [password,setPassword]=useState(''),[backupCodes,setBackupCodes]=useState<string[]>([]),[savedBackup,setSavedBackup]=useState(false);
  useEffect(()=>{
    let active=true;
    authRuntime.auth.mfa.listFactors().then(({data,error})=>{
      if(!active)return;
      if(error){setError(error.message);return;}
      const verified=data.totp.filter(f=>f.status==='verified');
      setFactors(verified);setFactorId(verified[0]?.id || '');
      setCanEnroll(verified.length===0);
    }).catch(()=>{if(active)setError('Tidak dapat membaca autentikator. Muat ulang untuk mencoba lagi.');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);
  const enroll=async()=>{
    if(busy || factorId || !canEnroll)return;
    setBusy(true);setError('');
    try{
      const {data,error}=await authRuntime.auth.mfa.enroll({factorType:'totp',friendlyName:'New Hope Admin '+Date.now(),...(isNeonAuth?{password}:{})});
      if(error)throw error;
      setFactorId(data.id);setQr(data.totp.qr_code);setSecret(data.totp.secret);setBackupCodes(data.backupCodes||[]);setSavedBackup(false);
    }catch(err){setError((err as Error).message);}finally{setPassword('');setBusy(false);}
  };
  const verify=async(e:React.FormEvent)=>{
    e.preventDefault();if(busy || !factorId)return;
    setBusy(true);setError('');
    try{
      const {error}=await authRuntime.auth.mfa.challengeAndVerify({factorId,code});
      if(error)throw error;
      const session=await api.me();
      if(session.mfaRequired)throw new Error('Sesi belum terverifikasi. Coba kode terbaru.');
      setSecret('');setQr('');setCode('');setBackupCodes([]);onVerified(session);
    }catch(err){setCode('');setError((err as Error).message);}finally{setBusy(false);}
  };

  const content=(<>
      <h1 className="text-2xl font-bold">Verifikasi autentikator admin</h1>
    <p className="my-4">Akses admin memerlukan MFA. Tindakan perubahan memerlukan kode yang diverifikasi dalam 10 menit terakhir. Tindakan sebelumnya tidak dikirim ulang otomatis.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {loading ? <p role="status">Memeriksa autentikator…</p> : <>
      {!factorId&&canEnroll&&<>{isNeonAuth&&<label>Password akun<input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={e=>setPassword(e.target.value)} className="nh-input"/></label>}<button disabled={busy||isNeonAuth&&!password} onClick={enroll} className="nh-auth-submit">Aktifkan aplikasi autentikator</button></>}
      {(qr||secret)&&<div className="my-4">{qr&&<img src={qr.startsWith('data:')?qr:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr)} alt="QR untuk aplikasi autentikator pribadi Anda" width={200} height={200}/>}
        <p>Jika QR tidak terbaca, masukkan kunci ini secara manual. Jangan bagikan:</p><code className="break-all">{secret}</code></div>}
      {backupCodes.length>0&&<div className="my-4"><p>Simpan kode pemulihan ini secara pribadi. Setiap kode hanya dapat dipakai sekali.</p><ul>{backupCodes.map(value=><li key={value}><code>{value}</code></li>)}</ul><label><input type="checkbox" checked={savedBackup} onChange={e=>setSavedBackup(e.target.checked)}/> Saya sudah menyimpan kode pemulihan</label></div>}
      {factorId && <form onSubmit={verify} className="space-y-4 my-4">
        {factors.length>1 && <label>Autentikator<select disabled={busy} value={factorId} onChange={e=>setFactorId(e.target.value)}>{factors.map(f=><option key={f.id} value={f.id}>{f.friendly_name || f.id}</option>)}</select></label>}
        <label className="block" htmlFor="admin-totp">Kode 6 digit</label>
        <input id="admin-totp" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} className="nh-input"/>
        <button className="nh-auth-submit" disabled={busy || code.length!==6||backupCodes.length>0&&!savedBackup}>{busy?'Memverifikasi…':'Verifikasi'}</button>
      </form>}
    </>}
      <div className="flex flex-col gap-3 mt-6">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            try {
              await api.logout();
              onLogout();
            } catch {
              setError('Logout gagal. Coba kembali.');
            }
          }}
          className="text-sm text-gray-500 hover:text-gray-700 underline text-center"
        >
          Keluar
        </button>
      </div>
    </>);
  return embedded?content:<AuthLayout admin>{content}</AuthLayout>;
}
