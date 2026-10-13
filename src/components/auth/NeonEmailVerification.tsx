import {useState} from 'react';
import {createNeonVerificationClient} from '../../lib/auth/neonClient';

/** Pilot-only OTP UI; no passwords or OTP codes are logged or stored. */
export default function NeonEmailVerification() {
  const [email,setEmail]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [client]=useState(()=>createNeonVerificationClient(import.meta.env.VITE_NEON_AUTH_URL!));
  const run=async(verify:boolean)=>{
    setBusy(true);setMessage('');
    try {
      const result=verify?await client.emailOtp.verifyEmail({email:email.trim(),otp:code})
        :await client.emailOtp.sendVerificationOtp({email:email.trim(),type:'email-verification'});
      if(result.error)throw Error(result.error.message||'Verifikasi belum berhasil.');
      setMessage(verify?'Email terverifikasi. Masuk dengan password untuk melanjutkan.':'Jika akun tersedia, periksa kode verifikasi di email.');
      if(verify)setCode('');
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  };
  return <details className="nh-form-notice"><summary>Verifikasi email akun uji Neon</summary>
    <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" disabled={busy}/></label>
    <button type="button" disabled={busy||!email} onClick={()=>void run(false)}>Kirim kode verifikasi</button>
    <label>Kode email<input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={busy}/></label>
    <button type="button" disabled={busy||code.length!==6} onClick={()=>void run(true)}>Verifikasi email</button>
    {message&&<p role="status">{message}</p>}
  </details>;
}
