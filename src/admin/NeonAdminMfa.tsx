import {useEffect,useState,type FormEvent} from 'react';
import {supabase} from '../lib/supabase';
import {api,type Session} from './api';
import {AuthLayout} from '../components/auth/AuthLayout';
export default function NeonAdminMfa({onVerified,onLogout,embedded=false}:{onVerified:(s:Session)=>void;onLogout:()=>void;embedded?:boolean}){
 const [enrolled,setEnrolled]=useState<boolean>(),[qr,setQr]=useState(''),[secret,setSecret]=useState(''),[code,setCode]=useState(''),[recovery,setRecovery]=useState(false),[codes,setCodes]=useState<string[]>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function call(path:string,body={}){const {data}=await supabase.auth.getSession();const r=await fetch('/api/admin/mfa/'+path,{method:'POST',headers:{authorization:'Bearer '+data.session?.access_token,'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Verifikasi belum berhasil');return d;}
 useEffect(()=>{void call('status').then(d=>setEnrolled(d.enrolled)).catch(e=>setError(e.message));},[]);
 async function enroll(){setBusy(true);setError('');try{const d=await call('enroll');setQr(d.qr);setSecret(d.secret);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function verify(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{const d=await call('verify',recovery?{recoveryCode:code}:{code});sessionStorage.setItem('nh-neon-admin-mfa',d.token);setCode('');setSecret('');setQr('');if(d.recoveryCodes)setCodes(d.recoveryCodes);else onVerified(await api.me());}catch(e){setCode('');setError((e as Error).message);}finally{setBusy(false);}}
 const content=<div className="space-y-4"><h1 className="text-2xl font-bold">Verifikasi autentikator admin</h1><p>Identitas memakai Neon Auth managed. Akses admin memerlukan autentikator tambahan dan verifikasi ulang setiap 10 menit.</p>
 {codes?<><p>Simpan kode pemulihan ini di password manager pribadi. Setiap kode hanya berlaku sekali; kode tidak ditampilkan kembali.</p><pre className="select-all whitespace-pre-wrap">{codes.join('\n')}</pre><button className="nh-auth-submit" onClick={async()=>{setCodes(undefined);onVerified(await api.me());}}>Saya sudah menyimpan kode pemulihan</button></>:<>
 {enrolled===false&&!qr&&<button className="nh-auth-submit" disabled={busy} onClick={()=>void enroll()}>Aktifkan aplikasi autentikator</button>}
 {qr&&<><img src={qr} alt="QR aplikasi autentikator pribadi" width={200} height={200}/><code className="break-all">{secret}</code></>}
 {(enrolled||qr)&&<form onSubmit={verify} className="space-y-3"><label className="block">{recovery?'Kode pemulihan':'Kode autentikator'}<input className="nh-input" autoComplete="one-time-code" type={recovery?'password':'text'} inputMode={recovery?'text':'numeric'} required value={code} onChange={e=>setCode(e.target.value)} maxLength={recovery?64:6}/></label><button className="nh-auth-submit" disabled={busy||!code}>Verifikasi</button>{enrolled&&<button type="button" onClick={()=>{setRecovery(!recovery);setCode('');}}>{recovery?'Gunakan autentikator':'Gunakan kode pemulihan'}</button>}</form>}
 </>}{error&&<p role="alert" className="text-red-700">{error}</p>}<button onClick={async()=>{await api.logout();onLogout();}}>Keluar</button></div>;
 return embedded?content:<AuthLayout admin>{content}</AuthLayout>;
}
