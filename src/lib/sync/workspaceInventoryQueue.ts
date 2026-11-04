import {financialWorkspaceKey,type FinancialWorkspace} from './queue';
export type InventoryCommand={action:'RECEIVE'|'TRANSFER'|'ADJUST';commandId:string;businessId:string;outletId:string;moduleId:string;destinationOutletId?:string;reason?:string;purchase?:{totalAmount:number;occurredAt:string;description:string;allocations:Array<{moduleId:string;amount:number;approvalGrant:string}>};lines:Array<{productRef:string;quantity:number;moduleId?:string;expectedQuantity?:number}>};
const key=(workspace:FinancialWorkspace)=>'newhope_inventory_outbox_v1_'+financialWorkspaceKey(workspace);
export function pendingWorkspaceInventory(workspace:FinancialWorkspace):InventoryCommand|null{
 const raw=localStorage.getItem(key(workspace));if(!raw)return null;
 const row=JSON.parse(raw);if(row.actorRef!==workspace.actorRef||row.command?.businessId!==workspace.merchantId||row.command?.outletId!==workspace.outletId||row.command?.moduleId!==workspace.moduleId)throw Error('INVENTORY_QUEUE_SCOPE_MISMATCH');return row.command;
}
/** Persist original bytes before transport; only an explicit server ACK removes them. */
export async function flushWorkspaceInventory(workspace:FinancialWorkspace){
 const command=pendingWorkspaceInventory(workspace);if(!command)return null;
 const response=await fetch('/api/v1/sync/modules/inventory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(15000)});
 const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'INVENTORY_SYNC_UNAVAILABLE');
 const modules=[...new Set(command.lines.map(l=>l.moduleId||command.moduleId))].sort();
 if(data.commandId!==command.commandId||data.action!==command.action||data.lineCount!==command.lines.length||JSON.stringify([...(data.moduleIds||[])].sort())!==JSON.stringify(modules)||Boolean(data.financialRecorded)!==Boolean(command.purchase)||command.purchase&&(!Array.isArray(data.expenses)||data.expenses.length!==command.purchase.allocations.length||command.purchase.allocations.some(a=>!data.expenses.some((e:any)=>e.moduleId===a.moduleId&&Math.round(e.amount*100)===Math.round(a.amount*100)))))throw Error('INVENTORY_ACK_MISMATCH');
 if(pendingWorkspaceInventory(workspace)?.commandId===command.commandId)localStorage.removeItem(key(workspace));
 window.dispatchEvent(new Event('outlets-updated'));if(data.financialRecorded)window.dispatchEvent(new Event('financial-updated'));return data;
}
export async function submitWorkspaceInventory(workspace:FinancialWorkspace,input:Omit<InventoryCommand,'commandId'|'businessId'|'outletId'|'moduleId'>&{commandId?:string}){
 if(pendingWorkspaceInventory(workspace))throw Error('INVENTORY_COMMAND_PENDING_RETRY_REQUIRED');
 const command:InventoryCommand={...input,commandId:input.commandId||crypto.randomUUID(),businessId:workspace.merchantId,outletId:workspace.outletId,moduleId:workspace.moduleId};
 localStorage.setItem(key(workspace),JSON.stringify({actorRef:workspace.actorRef,command}));
 return flushWorkspaceInventory(workspace);
}

/** Replace expired approval tokens only; original identity, stock and money stay immutable. */
export function renewWorkspacePurchaseApprovals(workspace:FinancialWorkspace,commandId:string,grants:Record<string,string>){
 const command=pendingWorkspaceInventory(workspace);if(!command?.purchase||command.commandId!==commandId)throw Error('PURCHASE_QUEUE_CHANGED');
 const allocations=command.purchase.allocations.map(a=>{if(typeof grants[a.moduleId]!=='string'||!grants[a.moduleId])throw Error('PURCHASE_APPROVAL_REQUIRED');return {...a,approvalGrant:grants[a.moduleId]};});
 localStorage.setItem(key(workspace),JSON.stringify({actorRef:workspace.actorRef,command:{...command,purchase:{...command.purchase,allocations}}}));
}
