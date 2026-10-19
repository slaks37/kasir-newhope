import {useEffect,useState,type FormEvent} from 'react';
import QRCode from 'react-qr-code';
import {betterClient,completeBetterTotp} from '../lib/auth/betterClient';
import {api,type Session} from './api';
import {AuthLayout} from '../components/auth/AuthLayout';

export default function BetterAdminMfa({onVerified,onLogout,embedded=false}:{onVerified:(session:Session)=>void;onLogout:()=>void;embedded?:boolean}) {
  const [enabled,setEnabled]=useState(false),[loading,setLoading]=useState(true),[password,setPassword]=useState(''),[uri,setUri]=useState(''),[codes,setCodes]=useState<string[]>([]),[saved,setSaved]=useState(false);
  const [code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;betterClient.getSession().then(r=>{if(!active)return;if(r.error||!r.data)throw Error('Masuk kembali untuk menyiapkan MFA.');setEnabled(Boolean(r.data.user.twoFactorEnabled));})
    .catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  async function enroll(e:FormEvent){e.preventDefault();setBusy(true);setError('');
    try{const r=await betterClient.twoFactor.enable({password,method:'totp'});setPassword('');if(r.error)throw Error(r.error.message||'Aktivasi belum berhasil.');if(r.data.method!=='totp')throw Error('Metode MFA tidak sesuai.');setUri(r.data.totpURI);setCodes(r.data.backupCodes);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function verify(e:FormEvent){e.preventDefault();setBusy(true);setError('');
    try{await completeBetterTotp(code);const session=await api.me();if(session.mfaRequired)throw Error('MFA belum terverifikasi.');setUri('');setCodes([]);setCode('');onVerified(session);}
    catch(e){setError((e as Error).message);setCode('');}finally{setBusy(false);}}
  const content=<div className="space-y-4"><h1 className="text-2xl font-bold">Verifikasi autentikator admin</h1>
    <p>Perubahan admin memerlukan kode yang diverifikasi dalam 10 menit terakhir. Tindakan sebelumnya tidak dikirim ulang otomatis.</p>
    {loading?<p role="status">Memeriksa sesi…</p>:!enabled&&!uri?<form onSubmit={enroll} className="space-y-4">
      <label>Password akun<input type="password" autoComplete="current-password" required value={password} disabled={busy} onChange={e=>setPassword(e.target.value)} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"/></label>
      <button className="nh-app-button-primary nh-auth-submit" disabled={busy}>Aktifkan aplikasi autentikator</button></form>:null}
    {uri&&<div className="space-y-4"><QRCode value={uri} size={200} title="QR autentikator pribadi"/>
      <p>Alternatif kunci manual: <code className="break-all">{new URL(uri).searchParams.get('secret')}</code></p>
      <p>Simpan kode pemulihan ini di tempat aman. Setiap kode hanya dapat digunakan sekali. Jangan bagikan.</p>
      <pre>{codes.join('\n')}</pre><label><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/> Saya sudah menyimpan kode pemulihan</label></div>}
    {(enabled||uri)&&<form onSubmit={verify} className="space-y-4"><label>Kode 6 digit<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"/></label>
      <button className="nh-app-button-primary nh-auth-submit" disabled={busy||code.length!==6||Boolean(uri&&!saved)}>Verifikasi</button></form>}
    {error&&<p role="alert">{error}</p>}
    <button disabled={busy} onClick={async()=>{try{await api.logout();onLogout();}catch{setError('Logout gagal. Coba kembali.');}}}>Keluar</button>
  </div>;
  return embedded?content:<AuthLayout admin>{content}</AuthLayout>;
}
