import React from 'react';
import {usePOSFields} from '../../context/POSDomains';
import {financeRequest} from '../../lib/auth/financialApprovalClient';
export function FinancialPinSetup(){
  const {settings,activeBranch}=usePOSFields(['settings','activeBranch']);
  const [ownerPassword,setPassword]=React.useState('');
  const [currentPin,setCurrent]=React.useState(''),[newPin,setNew]=React.useState(''),[message,setMessage]=React.useState(''),[busy,setBusy]=React.useState(false);
  return <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
    <h2 className="font-bold">PIN finansial server pemilik</h2>
    <p className="text-sm">PIN ini berbeda dari PIN profil kasir lokal. Void, refund, kas keluar, dan pembalikan kas membutuhkan persetujuan server saat online. PIN bawaan 1234 ditolak. Saat ini persetujuan hanya tersedia bagi akun pemilik yang login; profil manager lokal belum menjadi identitas server.</p>
    <form className="space-y-3" onSubmit={async e=>{e.preventDefault();setBusy(true);setMessage('');
      try{await financeRequest('pin',{sector:settings.businessSector,outletId:activeBranch?.id,currentPin,newPin,ownerPassword});setMessage('PIN finansial server tersimpan.');setCurrent('');setNew('');}
      catch(error){setMessage(error instanceof Error?error.message:'PIN tidak tersimpan');}finally{setPassword('');setBusy(false);}}}>
      <label className="block">Password akun pemilik (verifikasi ulang)<input required type="password" autoComplete="current-password" value={ownerPassword} onChange={e=>setPassword(e.target.value)} className="block rounded border p-2"/></label>
      <p className="text-sm">Akun Google/OAuth perlu menetapkan password melalui pemulihan akun sebelum mendaftarkan PIN.</p>
      <label className="block">PIN saat ini (kosong saat pertama kali)<input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={currentPin} onChange={e=>setCurrent(e.target.value)} className="block rounded border p-2"/></label>
      <label className="block">PIN baru, 4–8 digit<input required type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,8}" maxLength={8} value={newPin} onChange={e=>setNew(e.target.value)} className="block rounded border p-2"/></label>
      <button disabled={busy} className="rounded bg-amber-400 px-4 py-2 font-bold">{busy?'Menyimpan…':'Simpan PIN finansial'}</button>
      {message&&<p role="status">{message}</p>}
    </form>
  </section>;
}
