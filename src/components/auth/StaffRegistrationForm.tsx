import {useState} from 'react';
import {authRuntime} from '../../lib/authRuntime';

/** Personal identity only: never use merchant registration/default store metadata. */
export function StaffRegistrationForm({onSignIn}:{onSignIn:()=>void}) {
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [busy,setBusy]=useState(false),[submitted,setSubmitted]=useState(false),[error,setError]=useState('');
 const submit=async(e:React.FormEvent)=>{
  e.preventDefault();if(busy)return;setBusy(true);setError('');
  try {
   const response=await authRuntime.auth.signUp({email:email.trim().toLowerCase(),password,options:{emailRedirectTo:window.location.origin+'/login',data:{full_name:name.trim()}}});
   if(response.error)throw response.error;
   setSubmitted(true);
  } catch(e) {setError((e as Error).message||'Pendaftaran belum dapat diproses.');}
  finally {setPassword('');setBusy(false);}
 };
 if(submitted)return <div className="space-y-3"><p role="status">Periksa email untuk verifikasi akun, lalu masuk dengan email penerima undangan. Jika akun sudah terdaftar, gunakan login atau reset password.</p><button onClick={onSignIn} className="underline">Masuk sebagai staf</button></div>;
 return <form onSubmit={e=>void submit(e)} className="space-y-4"><h2 className="font-bold">Buat identitas staf</h2><p>Akun ini tidak membuat toko, outlet, atau langganan. Penugasan baru berlaku setelah email terverifikasi dan undangan diterima.</p><label className="block">Nama lengkap<input className="nh-input" autoComplete="name" maxLength={100} required value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label><label className="block">Email penerima undangan<input className="nh-input" type="email" autoComplete="email" maxLength={160} required value={email} disabled={busy} onChange={e=>setEmail(e.target.value)}/></label><label className="block">Password akun staf<input className="nh-input" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label><p>Password minimal 12 karakter. Jangan gunakan password akun Google atau bagikan kepada pemilik bisnis.</p><label className="block"><input required type="checkbox" disabled={busy}/> Saya menerima <a href="/terms" target="_blank" rel="noreferrer" className="underline">syarat layanan</a> dan telah membaca <a href="/privacy" target="_blank" rel="noreferrer" className="underline">pemberitahuan privasi</a>.</label><button disabled={busy} className="rounded bg-amber-400 px-4 py-3 font-bold">{busy?'Memproses…':'Daftar akun staf'}</button><button type="button" disabled={busy} className="ml-4 underline" onClick={onSignIn}>Sudah punya akun</button>{error&&<p role="alert">{error}</p>}</form>;
}
