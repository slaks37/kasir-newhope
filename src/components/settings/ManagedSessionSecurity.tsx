import {useRef,useState} from 'react';
import {managedAuth} from '../../lib/auth/neonManaged';
import {usesNeonAuth} from '../../lib/supabase';
import {clearRevokedManagedProfile,revokeManagedSessions} from '../../lib/auth/managedSessions';

export function ManagedSessionSecurity(){
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const inFlight=useRef(false);
 if(!usesNeonAuth||!managedAuth)return null;
 async function revoke(){
  if(inFlight.current||!managedAuth)return;
  if(navigator.onLine===false){setError('Sambungkan internet untuk mengakhiri sesi perangkat.');return;}
  inFlight.current=true;setBusy(true);setError('');
  try{
   await revokeManagedSessions(managedAuth);
   clearRevokedManagedProfile();
   // Reload clears both SDK instances and their in-memory bearer cache.
   window.location.assign('/login');
  }catch{setError('Pencabutan sesi belum terkonfirmasi. Tetap di halaman ini dan coba lagi secara manual.');}
  finally{inFlight.current=false;setBusy(false);}
 }
 return <section aria-labelledby="managed-session-security-title" className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
  <h3 id="managed-session-security-title" className="font-bold text-slate-900">Keamanan akun</h3>
  <p className="text-sm text-slate-600">Setelah reset password atau jika perangkat hilang, akhiri seluruh sesi akun Anda. Reset password saja tidak otomatis mengeluarkan perangkat lain.</p>
  <p className="text-sm text-slate-600">Anda juga akan keluar dari perangkat ini. Transaksi lokal yang belum tersinkron tidak dihapus. Pemutusan akses API yang sudah terbit dapat memerlukan hingga 15 menit.</p>
  {confirm?<div className="flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={()=>void revoke()} className="rounded border border-red-300 px-3 py-2 font-bold text-red-800">{busy?'Mengakhiri sesi…':'Konfirmasi keluar dari semua perangkat'}</button><button type="button" disabled={busy} onClick={()=>{setConfirm(false);setError('');}} className="rounded border px-3 py-2">Batal</button></div>:<button type="button" onClick={()=>setConfirm(true)} className="rounded border px-3 py-2 font-bold">Keluar dari semua perangkat</button>}
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
 </section>;
}
