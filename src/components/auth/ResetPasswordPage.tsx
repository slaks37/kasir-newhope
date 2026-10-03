import {useState,type FormEvent} from 'react';
import {useAuth} from '../../context/AuthContext';
import {supabase} from '../../lib/supabase';
import {navigate} from '../../lib/navigation/workspaceRouter';
import {AuthLayout} from './AuthLayout';

/** Recovery uses the existing Supabase session restored from the email link. */
export default function ResetPasswordPage() {
  const {user,session,configured}=useAuth();
  const [password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
  const ready=configured&&!!user&&!!session;
  const submit=async(e:FormEvent)=>{
    e.preventDefault();if(!ready||busy)return;setError('');
    if(password.length<12||password!==confirmation){setError('Gunakan minimal 12 karakter dan konfirmasi yang sama.');return;}
    setBusy(true);
    try{
      // Revalidate with Auth, not localStorage or a user supplied account ID.
      const verified=await supabase.auth.getUser();
      if(verified.error||verified.data.user?.id!==user.id)throw new Error('Sesi pemulihan tidak valid. Minta tautan baru.');
      const result=await supabase.auth.updateUser({password});
      if(result.error)throw new Error('Password belum diperbarui. Tautan mungkin kedaluwarsa atau password tidak memenuhi kebijakan keamanan.');
      setPassword('');setConfirmation('');setDone(true);
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  };
  return <AuthLayout><div className="space-y-4"><h1 className="text-2xl font-bold">Atur password baru</h1>
    {done?<><p role="status">Password berhasil diperbarui. Masuk kembali dengan password baru.</p><button className="nh-app-button-primary nh-auth-submit" disabled={busy} onClick={async()=>{setBusy(true);const result=await supabase.auth.signOut({scope:'local'});setBusy(false);if(result.error)setError('Belum bisa keluar dari sesi. Coba lagi.');else navigate('/login',true);}}>Ke halaman login</button></>:ready?<form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-500">Untuk akun {user.email}. Admin tidak menerima password ini.</p>
      <label className="block">Password baru<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} value={password} onChange={e=>setPassword(e.target.value)} className="border rounded-lg w-full p-3"/></label>
      <label className="block">Konfirmasi password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} value={confirmation} onChange={e=>setConfirmation(e.target.value)} className="border rounded-lg w-full p-3"/></label>
      <button disabled={busy} className="nh-app-button-primary nh-auth-submit">{busy?'Menyimpan…':'Simpan password baru'}</button>
    </form>:<p>Tautan reset tidak valid atau sudah kedaluwarsa. Buka tautan terbaru dari email, atau minta support mengirim ulang.</p>}
    {error&&<p role="alert" className="text-red-700">{error}</p>}
  </div></AuthLayout>;
}
