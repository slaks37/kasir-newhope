import {useEffect,useState} from 'react';
import {isNative} from './platform';
import {authRuntime as supabase,isAuthConfigured as isSupabaseConfigured,isNeonAuth} from '../../lib/authRuntime';
import {nativeCallback} from './nativeLifecycle';
export function NativeStatus(){
 const [error,setError]=useState(''),[email,setEmail]=useState(''),[recovery,setRecovery]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{const failed=()=>setError('Sesi native belum dapat dipulihkan. Coba masuk kembali; antrean tidak dihapus.');window.addEventListener('native-auth-error',failed);return()=>window.removeEventListener('native-auth-error',failed);},[]);
 if(!isNative())return null;
 return <aside className="bg-amber-100 p-3 text-sm space-y-2"><p>Native Preview — transaksi belum diaktifkan. Data tertunda tetap berada pada perangkat asal.</p>{!isSupabaseConfigured&&<p>Build ini belum dikonfigurasi untuk login hosted.</p>}<button onClick={()=>setRecovery(!recovery)}>Pemulihan akun</button>{recovery&&<form onSubmit={async e=>{e.preventDefault();if(busy||!isSupabaseConfigured)return;setBusy(true);try{const {error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:isNeonAuth?new URL('/reset-password',import.meta.env.VITE_NEWHOPE_AUTH_URL).href:nativeCallback});setError(error?'Permintaan belum berhasil. Coba lagi.':'Jika akun terdaftar, periksa email dan buka tautannya pada perangkat ini.');}catch{setError('Koneksi gagal. Coba lagi.');}finally{setBusy(false);}}}><label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} className="border p-2"/></label><button disabled={busy||!isSupabaseConfigured}>Kirim tautan pemulihan</button></form>}{error&&<p role="alert">{error}</p>}</aside>;
}
