import {useState,useEffect,useRef,type FormEvent} from 'react';
import {managedAuth} from '../../lib/auth/neonManaged';
import {recoveryEmail,verificationCode,verificationFailure} from '../../lib/auth/managedRecovery';
import {AuthLayout} from './AuthLayout';
export function NeonLoginHelp({email,onEmailChange}:{email:string;onEmailChange:(email:string)=>void}){
 const recipient=recoveryEmail(email);
 const [entry,setEntry]=useState({email:'',code:''}),[notice,setNotice]=useState({email:'',message:''}),[busy,setBusy]=useState(false);
 const inFlight=useRef(false);
 useEffect(()=>{setEntry({email:recipient,code:''});setNotice({email:recipient,message:''});},[recipient]);
 // Changing either email input invalidates the previous code and notice.
 const code=entry.email===recipient?entry.code:'',message=notice.email===recipient?notice.message:'';
 function begin(){if(inFlight.current||!recipient)return false;inFlight.current=true;setBusy(true);setNotice({email:recipient,message:''});return true;}
 function finish(){inFlight.current=false;setBusy(false);}
 async function send(kind:'verify'|'reset'){
  if(!begin())return;
  try{
   if(!managedAuth)throw Error('Auth belum tersedia');
   const r=kind==='verify'?await managedAuth.emailOtp.sendVerificationOtp({email:recipient,type:'email-verification'}):await managedAuth.requestPasswordReset({email:recipient,redirectTo:window.location.origin+'/reset-password'});
   if(r.error)throw r.error;
   setEntry({email:recipient,code:''});
   setNotice({email:recipient,message:'Jika akun memenuhi syarat, periksa email dan spam Anda. Gunakan pesan terbaru untuk alamat di atas.'});
  }catch{setNotice({email:recipient,message:'Permintaan belum berhasil. Coba lagi secara manual; pesan tidak dikirim ulang otomatis.'});}
  finally{finish();}
 }
 async function verify(e:FormEvent){
  e.preventDefault();const otp=verificationCode(code);if(!otp||!begin())return;
  try{
   if(!managedAuth)throw Error('Auth belum tersedia');
   const r=await managedAuth.emailOtp.verifyEmail({email:recipient,otp});if(r.error)throw r.error;
   setEntry({email:recipient,code:''});setNotice({email:recipient,message:'Email terverifikasi. Silakan masuk dengan password Anda.'});
  }catch(error){setNotice({email:recipient,message:verificationFailure(error)});}
  finally{finish();}
 }
 return <details className="mt-6"><summary>Verifikasi email atau lupa password</summary><div className="space-y-3 mt-3">
  <label>Email untuk verifikasi/reset<input type="email" autoComplete="email" className="nh-input" value={email} disabled={busy} onChange={e=>onEmailChange(e.target.value)}/></label>
  <p>{recipient?<>Kode harus berasal dari email terbaru untuk <strong>{recipient}</strong>.</>:'Isi email akun di atas terlebih dahulu.'} Masukkan kode angka dari email, bukan password. Tidak ada pengiriman otomatis.</p>
  <div className="flex gap-3"><button disabled={busy||!recipient} type="button" onClick={()=>void send('verify')}>Kirim kode verifikasi</button><button disabled={busy||!recipient} type="button" onClick={()=>void send('reset')}>Reset password</button></div>
  <form onSubmit={verify}><label>Kode verifikasi email<input className="nh-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]+" maxLength={32} title="Masukkan hanya angka dari email verifikasi terbaru." disabled={busy} value={code} onChange={e=>setEntry({email:recipient,code:e.target.value.trim()})} required/></label><button disabled={busy||!recipient||!verificationCode(code)}>Verifikasi email</button></form>
  {message&&<p role="status">{message}</p>}
 </div></details>;
}
export function NeonResetPasswordPage(){
 const [token]=useState(()=>new URLSearchParams(location.search).get('token')),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
 useEffect(()=>{if(token){const u=new URL(location.href);u.searchParams.delete('token');history.replaceState(history.state,'',u.pathname+u.search+u.hash);}},[token]);
 async function reset(e:FormEvent){e.preventDefault();if(!token||password!==confirmation){setError('Konfirmasi password harus sama.');return;}setBusy(true);setError('');try{const r=await managedAuth!.resetPassword({token,newPassword:password});if(r.error)throw Error('Tautan tidak valid atau kedaluwarsa.');setPassword('');setConfirmation('');setDone(true);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <AuthLayout><div className="space-y-4"><h1 className="text-2xl font-bold">Atur password baru</h1>{done?<><p>Password diperbarui. Masuk kembali dengan password baru.</p><a href="/login">Ke halaman login</a></>:token?<form className="space-y-4" onSubmit={reset}><label>Password baru<input className="nh-input" autoComplete="new-password" type="password" minLength={12} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Konfirmasi<input className="nh-input" type="password" autoComplete="new-password" required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label><button className="nh-auth-submit" disabled={busy}>Simpan password baru</button></form>:<p>Tautan tidak valid. Minta reset baru.</p>}{error&&<p role="alert">{error}</p>}</div></AuthLayout>;
}
