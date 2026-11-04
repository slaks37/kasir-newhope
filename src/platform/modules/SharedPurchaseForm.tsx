import React,{useEffect,useState} from 'react';
import {useBusinessModule} from './ModuleContext';
import {moduleManifest} from './registry';
import {useWorkspaceBusiness} from '../../context/WorkspaceBusinessContext';
import {useAuth} from '../../context/AuthContext';
import {requestFinancialApproval} from '../../lib/auth/financialApprovalClient';
import {sharedPurchaseCashCommand} from '../../lib/pos/workspacePurchase';
import {pendingWorkspaceInventory,submitWorkspaceInventory,flushWorkspaceInventory,renewWorkspacePurchaseApprovals,type InventoryCommand} from '../../lib/sync/workspaceInventoryQueue';
import type {Product} from '../../types';
type Line={key:string;moduleId:string;productRef:string;quantity:number;amount:number};
export function SharedPurchaseForm(){
 const runtime=useBusinessModule(),workspace=useWorkspaceBusiness(),actor=useAuth().user!;
 const [open,setOpen]=useState(false),[catalog,setCatalog]=useState<Record<string,Product[]>>({}),[catalogError,setCatalogError]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[description,setDescription]=useState(''),[total,setTotal]=useState(0),[lines,setLines]=useState<Line[]>([]);
 const grants=runtime?.access.modules.filter(m=>m.workspaceVersion===2&&['inventory','pos'].every(p=>m.features.includes(p)&&m.permissions.includes(p)))||[];
 const key=runtime?JSON.stringify([runtime.access.businessId,runtime.access.outletId,grants.map(g=>g.id)]):'';
 useEffect(()=>{if(!open||!runtime)return;const controller=new AbortController();setCatalogError('');
  void Promise.all(grants.map(async g=>{const response=await fetch('/api/v1/sync/modules/state?'+new URLSearchParams({businessId:runtime.access.businessId,outletId:runtime.access.outletId,moduleId:g.id,kinds:'products'}),{cache:'no-store',signal:controller.signal});const data=await response.json();if(!response.ok||!data.ok||data.nextCursor)throw Error(data.nextCursor?'Katalog pembelian terlalu besar; gunakan penerimaan per modul.':data.error||'Katalog belum tersedia');return [g.id,data.records.filter((r:any)=>!r.deleted&&r.value?.inventoryTracked===true).map((r:any)=>r.value)] as const;})).then(entries=>{if(!controller.signal.aborted)setCatalog(Object.fromEntries(entries));}).catch(e=>{if(!controller.signal.aborted)setCatalogError(e instanceof Error?e.message:'Katalog belum tersedia');});
  return()=>controller.abort();
 },[open,key]);
 if(runtime?.grant.workspaceVersion!==2||grants.length<2)return null;
 const identity={tenantId:workspace.business.tenantId,merchantId:runtime.access.businessId,outletId:runtime.access.outletId,moduleId:runtime.manifest.id,actorRef:actor.id};
 let pending:InventoryCommand|null=null;try{pending=pendingWorkspaceInventory(identity);}catch{}
 const approve=async(command:InventoryCommand)=>{if(!command.purchase)throw Error('PURCHASE_REQUIRED');const tokens:Record<string,string>={};for(const allocation of command.purchase.allocations){const manifest=moduleManifest(allocation.moduleId);if(!manifest||!grants.some(g=>g.id===manifest.id))throw Error('WORKSPACE_PERMISSION_DENIED');const cash=sharedPurchaseCashCommand(command.commandId,allocation.moduleId,command.outletId,manifest.sector,allocation.amount,command.purchase.occurredAt,command.purchase.description);tokens[allocation.moduleId]=await requestFinancialApproval({businessId:command.businessId,moduleId:allocation.moduleId,outletId:command.outletId,sector:manifest.sector,action:'CASH_OUT',reference:cash.clientEventId,reason:command.purchase.description,command:cash});}return tokens;};
 const submit=async(retry=false)=>{setBusy(true);setError('');try{
  if(retry){const original=pendingWorkspaceInventory(identity);if(!original?.purchase)throw Error('Pembelian tersimpan tidak ditemukan');const tokens=await approve(original);renewWorkspacePurchaseApprovals(identity,original.commandId,tokens);await flushWorkspaceInventory(identity);}
  else{
   if(pendingWorkspaceInventory(identity))throw Error('Selesaikan perintah tersimpan terlebih dahulu');
   if(!description.trim()||!lines.length||lines.some(l=>!l.productRef||!grants.some(g=>g.id===l.moduleId)||!catalog[l.moduleId]?.some(p=>p.id===l.productRef)||!Number.isFinite(l.quantity)||l.quantity<=0||!Number.isFinite(l.amount)||l.amount<=0||Math.abs(l.amount*100-Math.round(l.amount*100))>0.001)||!Number.isFinite(total)||total<=0||lines.reduce((n,l)=>n+Math.round(l.amount*100),0)!==Math.round(total*100))throw Error('Periksa barang, jumlah dan alokasi; total alokasi harus sama dengan nilai tagihan.');
   const amounts=new Map<string,number>();for(const line of lines)amounts.set(line.moduleId,(amounts.get(line.moduleId)||0)+Math.round(line.amount*100));
   const command:InventoryCommand={action:'RECEIVE',commandId:crypto.randomUUID(),businessId:identity.merchantId,outletId:identity.outletId,moduleId:identity.moduleId,lines:lines.map(l=>({moduleId:l.moduleId,productRef:l.productRef,quantity:l.quantity})),purchase:{totalAmount:total,occurredAt:new Date().toISOString(),description:description.trim(),allocations:[...amounts].map(([moduleId,cents])=>({moduleId,amount:cents/100,approvalGrant:''}))}};
   const tokens=await approve(command);for(const allocation of command.purchase!.allocations)allocation.approvalGrant=tokens[allocation.moduleId];
   await submitWorkspaceInventory(identity,command);setLines([]);setDescription('');setTotal(0);
  }setError('Pembelian, alokasi kas dan stok dikonfirmasi server.');
 }catch(e){setError((e instanceof Error?e.message:'Pembelian belum dikonfirmasi')+' · Perintah yang sudah tersimpan tetap menunggu konfirmasi.');}finally{setBusy(false);}};
 const update=(line:Line,value:Partial<Line>)=>setLines(previous=>previous.map(l=>l.key===line.key?{...l,...value}:l));
 return <section className="rounded-xl border bg-white p-4 space-y-3"><button type="button" className="rounded border p-2" onClick={()=>{setOpen(!open);if(!lines.length)setLines(grants.map(g=>({key:crypto.randomUUID(),moduleId:g.id,productRef:'',quantity:1,amount:0})));}}>Pembelian bersama lintas modul</button>
  {pending?.purchase&&<div><p>Pembelian {pending.commandId} tersimpan. Jumlah dan alokasi tetap memakai perintah asal.</p><button disabled={busy} className="border rounded p-2" onClick={()=>void submit(true)}>Perbarui persetujuan dan kirim ulang pembelian</button></div>}
  {open&&<form onSubmit={e=>{e.preventDefault();void submit();}} className="space-y-3"><p className="text-sm">Mencatat penerimaan barang dan pengeluaran kas. Setiap modul memerlukan persetujuan finansial akun Anda; seluruh alokasi harus cocok dengan tagihan.</p><fieldset disabled={busy||!!pending} className="space-y-3"><label className="block">Keterangan tagihan<input required maxLength={240} value={description} onChange={e=>setDescription(e.target.value)} className="block border rounded p-2 w-full"/></label>
   <label className="block">Total tagihan (Rp)<input required type="number" min="0.01" step="0.01" max="9999999999" value={total} onChange={e=>setTotal(Number(e.target.value))} className="block border rounded p-2"/></label>
   {lines.map((line,index)=><div key={line.key} className="flex flex-wrap gap-3 rounded border p-3"><label>Modul baris {index+1}<select value={line.moduleId} onChange={e=>update(line,{moduleId:e.target.value,productRef:''})} className="block border rounded p-2">{grants.map(g=><option key={g.id} value={g.id}>{moduleManifest(g.id)?.name}</option>)}</select></label>
    <label>Barang baris {index+1}<select required value={line.productRef} onChange={e=>update(line,{productRef:e.target.value})} className="block border rounded p-2"><option value="">Pilih barang</option>{(catalog[line.moduleId]||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>Jumlah baris {index+1}<input required type="number" min="0.001" step="0.001" max="999999" value={line.quantity} onChange={e=>update(line,{quantity:Number(e.target.value)})} className="block border rounded p-2 w-24"/></label>
    <label>Alokasi kas baris {index+1} (Rp)<input required type="number" min="0.01" max="9999999999" step="0.01" value={line.amount} onChange={e=>update(line,{amount:Number(e.target.value)})} className="block border rounded p-2 w-36"/></label><button type="button" onClick={()=>setLines(previous=>previous.filter(l=>l.key!==line.key))}>Hapus baris</button></div>)}
   <button type="button" className="border rounded p-2" onClick={()=>setLines(previous=>[...previous,{key:crypto.randomUUID(),moduleId:runtime.manifest.id,productRef:'',quantity:1,amount:0}])}>Tambah baris pembelian</button><p>Total alokasi: Rp {(lines.reduce((n,l)=>n+Math.round(l.amount*100),0)/100).toLocaleString('id-ID')}</p><button disabled={!!catalogError||!Object.keys(catalog).length} className="border rounded p-3">Setujui dan catat pembelian</button>
  </fieldset>{catalogError&&<p role="alert">{catalogError}</p>}</form>}
  {error&&<p role="status">{error}</p>}
 </section>;
}
