import React,{useEffect,useState} from 'react';
import {useBusinessModule} from './ModuleWorkspaceGate';
import {useWorkspaceBusiness} from '../../context/WorkspaceBusinessContext';
import {useAuth} from '../../context/AuthContext';
import {usePOSFields} from '../../context/POSDomains';
import {submitWorkspaceRecipe,flushWorkspaceRecipe,pendingWorkspaceRecipe,type RecipeInput} from '../../lib/sync/workspaceRecipeQueue';
type Ingredient={id:string;name:string;unit:string;quantity:string};
type Recipe={id:string;product_ref:string;revision:string;yield_quantity:string;lines:Array<{ingredientId:string;quantity:number;wastagePercentage:number}>};
export function WorkspaceRecipes(){
 const runtime=useBusinessModule();
 if(runtime?.grant.workspaceVersion!==2||runtime.manifest.id==='retail'||!runtime.grant.permissions.includes('inventory')||!runtime.grant.features.includes('inventory'))return null;
 return <RecipeEditor key={runtime.access.businessId+':'+runtime.access.outletId+':'+runtime.manifest.id}/>;
}
function RecipeEditor(){
 const runtime=useBusinessModule()!,business=useWorkspaceBusiness(),actor=useAuth().user!;
 const {products}=usePOSFields(['products']);
 const identity={tenantId:business.business.tenantId,merchantId:runtime.access.businessId,outletId:runtime.access.outletId,moduleId:runtime.manifest.id,actorRef:actor.id};
 const [ingredients,setIngredients]=useState<Ingredient[]>([]),[recipes,setRecipes]=useState<Recipe[]>([]),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false);
 const [name,setName]=useState(''),[unit,setUnit]=useState('gram'),[cost,setCost]=useState(0),[sku,setSku]=useState('');
 const [ingredientId,setIngredientId]=useState(''),[quantity,setQuantity]=useState(1),[productRef,setProductRef]=useState(''),[yieldQuantity,setYield]=useState(1);
 const [lines,setLines]=useState<Array<{ingredientId:string;quantity:number;wastagePercentage:number}>>([]);
 const query=new URLSearchParams({businessId:identity.merchantId,outletId:identity.outletId,moduleId:identity.moduleId}).toString();
 const load=async(signal?:AbortSignal)=>{const response=await fetch('/api/v1/sync/modules/recipes?'+query,{signal});const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Resep belum dapat dimuat');setIngredients(data.ingredients);setRecipes(data.recipes);setReady(true);};
 useEffect(()=>{const controller=new AbortController();void load(controller.signal).catch(e=>{if(!controller.signal.aborted)setStatus(e.message);});return ()=>controller.abort();},[query]);
 let pending=false;try{pending=!!pendingWorkspaceRecipe(identity);}catch{}
 const run=async(input?:RecipeInput)=>{setBusy(true);try{if(input)await submitWorkspaceRecipe(identity,input);else await flushWorkspaceRecipe(identity);await load();setStatus('Perintah dikonfirmasi server.');}catch(e){setStatus(e instanceof Error?e.message:'Koneksi belum tersedia');}finally{setBusy(false);}};
 const selectedRecipe=recipes.find(r=>r.product_ref===productRef);
 return <section aria-label="Resep dan bahan baku" className="border rounded-xl bg-white p-4 space-y-4">
  <h3 className="font-bold">Resep dan bahan baku</h3>
  {pending&&<button disabled={busy} onClick={()=>void run()} className="border p-2 rounded">Kirim ulang perintah bahan/resep tersimpan</button>}
  {status&&<p role="status">{status}</p>}
  {ready&&<>
   <form className="flex flex-wrap gap-2 items-end" onSubmit={e=>{e.preventDefault();void run({action:'CREATE_INGREDIENT',name,unit,cost,sku});}}>
    <label>Bahan<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} className="block border p-2"/></label>
    <label>SKU bahan<input required maxLength={50} value={sku} onChange={e=>setSku(e.target.value)} className="block border p-2"/></label>
    <label>Satuan<input required maxLength={20} value={unit} onChange={e=>setUnit(e.target.value)} className="block border p-2 w-24"/></label>
    <label>Biaya per satuan<input required type="number" min={0} max={999999} step="0.0001" value={cost} onChange={e=>setCost(Number(e.target.value))} className="block border p-2 w-28"/></label>
    <button disabled={busy||pending} className="border p-2 rounded">Tambah bahan</button>
   </form>
   <form className="flex flex-wrap gap-2 items-end" onSubmit={e=>{e.preventDefault();void run({action:'RECEIVE_INGREDIENT',ingredientId,quantity});}}>
    <label>Bahan<select required value={ingredientId} onChange={e=>setIngredientId(e.target.value)} className="block border p-2"><option value="">Pilih bahan</option>{ingredients.map(i=><option key={i.id} value={i.id}>{i.name} · {i.quantity} {i.unit}</option>)}</select></label>
    <label>Jumlah diterima<input required type="number" min="0.001" max={999999} step="0.001" value={quantity} onChange={e=>setQuantity(Number(e.target.value))} className="block border p-2 w-28"/></label>
    <button disabled={busy||pending} className="border p-2 rounded">Terima bahan</button>
   </form>
   <form className="space-y-3" onSubmit={e=>{e.preventDefault();void run({action:'SET_RECIPE',productRef,baseRevision:Number(selectedRecipe?.revision||0),yieldQuantity,lines});}}>
    <div className="flex flex-wrap gap-2 items-end"><label>Produk resep<select required value={productRef} onChange={e=>{const id=e.target.value;setProductRef(id);const r=recipes.find(x=>x.product_ref===id);setYield(Number(r?.yield_quantity||1));setLines(r?.lines.map(l=>({...l,quantity:Number(l.quantity),wastagePercentage:Number(l.wastagePercentage)}))||[]);}} className="block border p-2"><option value="">Pilih produk</option>{products.filter(p=>!p.inventoryTracked).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
     <label>Hasil resep (satuan produk)<input required type="number" min="0.0001" max={999999} step="0.0001" value={yieldQuantity} onChange={e=>setYield(Number(e.target.value))} className="block border p-2 w-28"/></label></div>
    {lines.map((line,index)=><div key={line.ingredientId} className="flex flex-wrap gap-2 items-end"><span>{ingredients.find(i=>i.id===line.ingredientId)?.name}</span><label>Pemakaian ({ingredients.find(i=>i.id===line.ingredientId)?.unit})<input required type="number" min="0.0001" max={999999} step="0.0001" value={line.quantity} onChange={e=>setLines(lines.map((l,i)=>i===index?{...l,quantity:Number(e.target.value)}:l))} className="block border p-2 w-28"/></label><label>Susut %<input required type="number" min={0} max={100} step="0.01" value={line.wastagePercentage} onChange={e=>setLines(lines.map((l,i)=>i===index?{...l,wastagePercentage:Number(e.target.value)}:l))} className="block border p-2 w-24"/></label><button type="button" onClick={()=>setLines(lines.filter((_,i)=>i!==index))}>Hapus bahan</button></div>)}
    <label>Tambah komponen<select value="" onChange={e=>{if(e.target.value)setLines([...lines,{ingredientId:e.target.value,quantity:1,wastagePercentage:0}]);}} className="block border p-2"><option value="">Pilih bahan</option>{ingredients.filter(i=>!lines.some(l=>l.ingredientId===i.id)).map(i=><option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></label>
    <button disabled={busy||pending||!lines.length} className="border p-2 rounded">Simpan resep</button>
   </form>
  </>}
 </section>;
}
