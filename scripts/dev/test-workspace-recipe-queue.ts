import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {submitWorkspaceRecipe,flushWorkspaceRecipe,pendingWorkspaceRecipe} from '../../src/lib/sync/workspaceRecipeQueue';
const disk=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>disk.get(k)??null,setItem:(k:string,v:string)=>disk.set(k,v),removeItem:(k:string)=>disk.delete(k)}});
const w={tenantId:randomUUID(),merchantId:randomUUID(),outletId:randomUUID(),moduleId:'fnb',actorRef:randomUUID()};
const original=globalThis.fetch;
try{
 globalThis.fetch=async()=>{throw Error('Offline');};
 await assert.rejects(()=>submitWorkspaceRecipe(w,{action:'RECEIVE_INGREDIENT',ingredientId:randomUUID(),quantity:1}),/Offline/);
 const command=pendingWorkspaceRecipe(w)!;assert(command);assert.equal(pendingWorkspaceRecipe({...w,actorRef:randomUUID()}),null);
 await assert.rejects(()=>submitWorkspaceRecipe(w,{action:'CREATE_INGREDIENT',name:'Replacement',sku:'x',unit:'ml',cost:0}),/PENDING_RETRY/);
 const bytes=[...disk.values()][0];
 globalThis.fetch=async()=>({ok:true,json:async()=>({ok:true,...command,entityId:randomUUID(),workspace:{...w,actorRef:randomUUID()}})}) as Response;
 await assert.rejects(()=>flushWorkspaceRecipe(w),/ACK_MISMATCH/);assert.equal([...disk.values()][0],bytes);
 globalThis.fetch=async()=>({ok:false,json:async()=>({ok:false,error:'RECIPE_REVISION_CONFLICT'})}) as Response;
 await assert.rejects(()=>flushWorkspaceRecipe(w),/REVISION_CONFLICT/);assert.equal([...disk.values()][0],bytes);
 globalThis.fetch=async(_url,init)=>{assert.deepEqual(JSON.parse(String(init?.body)),command);return {ok:true,json:async()=>({ok:true,commandId:command.commandId,action:command.action,entityId:randomUUID(),workspace:w})} as Response;};
 await flushWorkspaceRecipe(w);assert.equal(pendingWorkspaceRecipe(w),null);
 console.log('PASS recipe outbox: durable intent, actor isolation, immutable retries, exact ACK, preserved conflict');
}finally{globalThis.fetch=original;}
