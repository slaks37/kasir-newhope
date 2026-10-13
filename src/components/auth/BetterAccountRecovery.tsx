import {useState,type FormEvent} from 'react';
import {betterClient,completeBetterTotp,completeBetterBackupCode} from '../../lib/auth/betterClient';
import {AuthLayout} from './AuthLayout';

export function BetterLoginHelp() {
  const [email,setEmail]=useState(''),[code,setCode]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [useBackup,setUseBackup]=useState(false);
  async function verify(e:FormEvent){e.preventDefault();setBusy(true);setMessage('');
    // AuthContext and the route guard restore the requested workspace route.
    // A second redirect would overwrite returnTo after successful MFA.
    try{if(useBackup)await completeBetterBackupCode(code.trim());else await completeBetterTotp(code);}catch(e){setMessage((e as Error).message);setCode('');}finally{setBusy(false);}}
  async function send(kind:'verify'|'reset') {
    if(!email||busy)return;setBusy(true);setMessage('');
    try {
      const result=kind==='verify'?await betterClient.sendVerificationEmail({email,callbackURL:window.location.origin+'/login'}):await betterClient.requestPasswordReset({email,redirectTo:window.location.origin+'/reset-password'});
      if(result.error)throw Error('Permintaan belum berhasil. Coba lagi nanti.');
      setMessage('Jika akun memenuhi syarat, tautan dikirim ke email. Periksa inbox dan spam.');
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="space-y-3 mt-6">
    <details><summary>Login dengan autentikator</summary><form onSubmit={verify} className="space-y-3 mt-3">
      <p>Masuk dengan email dan password terlebih dahulu, lalu masukkan kode autentikator.</p>
      <button type="button" disabled={busy} onClick={()=>{setUseBackup(!useBackup);setCode('');setMessage('');}}>{useBackup?'Gunakan kode autentikator':'Gunakan kode pemulihan'}</button>
      {useBackup?<><p>Setiap kode pemulihan hanya bisa dipakai sekali. Perubahan admin tetap memerlukan verifikasi autentikator.</p>
        <label>Kode pemulihan<input type="password" autoComplete="off" required maxLength={64} value={code} disabled={busy} onChange={e=>setCode(e.target.value)} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"/></label></>:
        <label>Kode MFA<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} value={code} disabled={busy} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"/></label>}
      <button className="nh-app-button-primary nh-auth-submit" disabled={busy||(useBackup?!code.trim():code.length!==6)}>{useBackup?'Masuk dengan kode pemulihan':'Verifikasi MFA'}</button></form></details>
    <details><summary>Verifikasi email atau lupa password</summary><div className="space-y-3 mt-3">
      <label>Email akun<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"/></label>
      <button type="button" disabled={busy||!email} onClick={()=>void send('verify')}>Kirim tautan verifikasi</button>
      <button type="button" disabled={busy||!email} onClick={()=>void send('reset')}>Kirim tautan reset password</button>
    </div></details>
    {message&&<p role="status">{message}</p>}
  </div>;
}
export function BetterResetPasswordPage() {
  const token=new URLSearchParams(window.location.search).get('token');
  const [password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();if(busy||!token)return;
    if(password!==confirmation){setError('Konfirmasi password harus sama.');return;}setBusy(true);setError('');
    try{const result=await betterClient.resetPassword({token,newPassword:password});if(result.error)throw Error('Tautan tidak valid atau kedaluwarsa. Minta tautan baru.');setPassword('');setConfirmation('');setDone(true);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <AuthLayout><div className="space-y-4"><h1 className="text-2xl font-bold">Atur password baru</h1>
    {done?<><p role="status">Password diperbarui dan sesi lama dicabut. Masuk kembali dengan password baru.</p><a href="/login">Ke halaman login</a></>:token?<form onSubmit={submit} className="space-y-4">
      <label>Password baru<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} disabled={busy} onChange={e=>setPassword(e.target.value)} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"/></label>
      <label>Konfirmasi password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"/></label>
      <button className="nh-app-button-primary nh-auth-submit" disabled={busy}>Simpan password baru</button>
    </form>:<p>Tautan reset tidak valid. Minta tautan baru di halaman login.</p>}
    {error&&<p role="alert">{error}</p>}
  </div></AuthLayout>;
}
