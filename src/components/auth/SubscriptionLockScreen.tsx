import React from 'react';
import {usePOS} from '../../context/POSContext';
export const SubscriptionLockScreen:React.FC<{onRenewSuccess:()=>void}>=()=>{
 const {setActiveTab}=usePOS();
 return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950" role="status">
 <h3 className="font-bold">Masa aktif berakhir</h3><p className="text-sm mt-2">Buka pengaturan untuk memperpanjang paket. Data tetap tersedia untuk ekspor; transaksi baru belum dapat dilakukan.</p>
 <button onClick={()=>setActiveTab('settings')} className="mt-3 px-4 py-2 bg-slate-900 text-white rounded-xl">Pilih paket</button></div>;
};
