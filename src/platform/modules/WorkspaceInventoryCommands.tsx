import React,{useState} from 'react';
import {useBusinessModule} from './ModuleWorkspaceGate';
import {useWorkspaceBusiness} from '../../context/WorkspaceBusinessContext';
import {useAuth} from '../../context/AuthContext';
import {usePOSFields} from '../../context/POSDomains';
import {submitWorkspaceInventory,flushWorkspaceInventory,pendingWorkspaceInventory} from '../../lib/sync/workspaceInventoryQueue';
export function WorkspaceInventoryCommands(){
 const runtime=useBusinessModule(),workspace=useWorkspaceBusiness(),actor=useAuth().user!;
 const {products}=usePOSFields(['products']);
 const [action,setAction]=useState<'RECEIVE'|'TRANSFER'>('RECEIVE');
 const [product,setProduct]=useState(''),[destination,setDestination]=useState(''),[quantity,setQuantity]=useState(1),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 if(runtime?.grant.workspaceVersion!==2)return null;
 const identity={tenantId:workspace.business.tenantId,merchantId:runtime.access.businessId,outletId:runtime.access.outletId,moduleId:runtime.manifest.id,actorRef:actor.id};
 let pending=false;try{pending=!!pendingWorkspaceInventory(identity);}catch{}
 const run=async(retry=false)=>{setBusy(true);setError('');try{if(retry)await flushWorkspaceInventory(identity);else await submitWorkspaceInventory(identity,{action,...(action==='TRANSFER'?{destinationOutletId:destination}:{}),lines:[{productRef:product,quantity}]});setError('Mutasi dikonfirmasi server.');}catch(e){setError((e instanceof Error?e.message:'Cloud belum tersedia')+' · Perintah yang tersimpan tetap menunggu konfirmasi.');}finally{setBusy(false);}};
 return <section className="rounded-xl border bg-white p-4 space-y-3" aria-label="Mutasi stok workspace"><p className="text-sm">Katalog modul dipakai bersama oleh outlet. Saldo stok mengikuti ledger masing-masing outlet; Terima barang atau transfer stok memakai perintah yang dikonfirmasi server. Resep dan bundel belum tersedia di workspace ini.</p>
  {pending&&<button disabled={busy} className="border rounded p-2" onClick={()=>void run(true)}>Kirim ulang mutasi tersimpan</button>}
  <form onSubmit={e=>{e.preventDefault();void run();}} className="flex flex-wrap gap-3 items-end"><label>Mutasi<select value={action} onChange={e=>setAction(e.target.value as typeof action)} className="block border rounded p-2"><option value="RECEIVE">Terima barang</option><option value="TRANSFER">Transfer stok</option></select></label><label>Produk<select aria-label="Produk transfer" required value={product} onChange={e=>setProduct(e.target.value)} className="block border rounded p-2"><option value="">Pilih produk</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   {action==='TRANSFER'&&<label>Outlet tujuan<select required value={destination} onChange={e=>setDestination(e.target.value)} className="block border rounded p-2"><option value="">Pilih outlet</option>{workspace.business.outlets.filter(o=>o.status==='ACTIVE'&&o.outletId!==identity.outletId).map(o=><option key={o.outletId} value={o.outletId}>{o.name}</option>)}</select></label>}
   <label>Jumlah<input required type="number" min="0.001" max="999999" step="0.001" value={quantity} onChange={e=>setQuantity(Number(e.target.value))} className="block border rounded p-2 w-28"/></label><button disabled={busy||pending} className="border rounded p-2">{busy?'Memproses…':action==='TRANSFER'?'Transfer stok':'Terima barang'}</button></form>
  {error&&<p role="status" className="text-sm">{error}</p>}
 </section>;
}
