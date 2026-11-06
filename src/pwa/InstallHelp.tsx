import {useEffect,useState} from 'react';
import {isNative} from '../platform/runtime/platform';
export function InstallHelp(){
 const [prompt,setPrompt]=useState<any>(null),[open,setOpen]=useState(false),[update,setUpdate]=useState(false);
 useEffect(()=>{if(isNative())return;const handler=(event:Event)=>{event.preventDefault();setPrompt(event);};window.addEventListener('beforeinstallprompt',handler);
  let alive=true;void navigator.serviceWorker?.getRegistration().then(r=>{if(alive)setUpdate(!!r?.waiting);});
  return()=>{alive=false;window.removeEventListener('beforeinstallprompt',handler);};},[]);
 if(isNative())return null;
 return <aside className="fixed bottom-2 right-2 z-50 max-w-sm rounded-xl bg-white shadow border text-sm p-2"><button onClick={()=>setOpen(!open)} aria-expanded={open}>Instalasi aplikasi{update?' · Pembaruan tersedia':''}</button>{open&&<div className="p-2 space-y-2"><p>Chrome/Edge: pilih Instal aplikasi. Safari iPhone/iPad: Bagikan → Tambahkan ke Layar Utama.</p>{prompt&&<button onClick={async()=>{await prompt.prompt();setPrompt(null);}}>Instal New Hope</button>}<p>Pembaruan diterapkan setelah seluruh jendela aplikasi ditutup. Pastikan transaksi tertunda sudah tersinkron sebelum memperbarui. Jangan hapus data situs jika masih ada antrean.</p></div>}</aside>;
}
