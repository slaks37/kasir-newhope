import {financialWorkspaceKey,type FinancialWorkspace} from './queue';
type InventoryCommand={action:'RECEIVE'|'TRANSFER'|'ADJUST';commandId:string;businessId:string;outletId:string;moduleId:string;destinationOutletId?:string;reason?:string;lines:Array<{productRef:string;quantity:number;moduleId?:string;expectedQuantity?:number}>};
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
 if(pendingWorkspaceInventory(workspace)?.commandId===command.commandId)localStorage.removeItem(key(workspace));
 window.dispatchEvent(new Event('outlets-updated'));return data;
}
export async function submitWorkspaceInventory(workspace:FinancialWorkspace,input:Omit<InventoryCommand,'commandId'|'businessId'|'outletId'|'moduleId'>){
 if(pendingWorkspaceInventory(workspace))throw Error('INVENTORY_COMMAND_PENDING_RETRY_REQUIRED');
 const command:InventoryCommand={...input,commandId:crypto.randomUUID(),businessId:workspace.merchantId,outletId:workspace.outletId,moduleId:workspace.moduleId};
 localStorage.setItem(key(workspace),JSON.stringify({actorRef:workspace.actorRef,command}));
 return flushWorkspaceInventory(workspace);
}
