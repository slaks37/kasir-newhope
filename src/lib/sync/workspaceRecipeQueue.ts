import {readFinancialValue,writeFinancialValue} from '../../platform/runtime/financialStorage';
import {financialWorkspaceKey,type FinancialWorkspace} from './queue';
export type RecipeInput={action:'CREATE_INGREDIENT';name:string;sku:string;unit:string;cost:number}|{action:'RECEIVE_INGREDIENT';ingredientId:string;quantity:number}|{action:'SET_RECIPE';productRef:string;baseRevision:number;yieldQuantity:number;lines:Array<{ingredientId:string;quantity:number;wastagePercentage:number}>};
type RecipeCommand=RecipeInput&{commandId:string;businessId:string;outletId:string;moduleId:string};
const key=(w:FinancialWorkspace)=>'newhope_recipe_outbox_v1_'+financialWorkspaceKey(w);
export function pendingWorkspaceRecipe(w:FinancialWorkspace):RecipeCommand|null{
 const raw=readFinancialValue(key(w));if(!raw)return null;const row=JSON.parse(raw);
 if(row.actorRef!==w.actorRef||row.command.businessId!==w.merchantId||row.command.outletId!==w.outletId||row.command.moduleId!==w.moduleId)throw Error('RECIPE_QUEUE_SCOPE_MISMATCH');return row.command;
}
export async function flushWorkspaceRecipe(w:FinancialWorkspace){
 const command=pendingWorkspaceRecipe(w);if(!command)return null;
 const response=await fetch('/api/v1/sync/modules/recipes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(15000)});
 const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'RECIPE_SYNC_UNAVAILABLE');
 if(data.commandId!==command.commandId||data.action!==command.action||typeof data.entityId!=='string'||data.workspace?.tenantId!==w.tenantId||data.workspace?.merchantId!==w.merchantId||data.workspace?.outletId!==w.outletId||data.workspace?.moduleId!==w.moduleId||data.workspace?.actorRef!==w.actorRef)throw Error('RECIPE_ACK_MISMATCH');
 if(pendingWorkspaceRecipe(w)?.commandId===command.commandId)await writeFinancialValue(key(w),null);
 return data;
}
export async function submitWorkspaceRecipe(w:FinancialWorkspace,input:RecipeInput){
 if(pendingWorkspaceRecipe(w))throw Error('RECIPE_COMMAND_PENDING_RETRY_REQUIRED');
 const command:RecipeCommand={...input,commandId:crypto.randomUUID(),businessId:w.merchantId,outletId:w.outletId,moduleId:w.moduleId};
 await writeFinancialValue(key(w),JSON.stringify({actorRef:w.actorRef,command}));return flushWorkspaceRecipe(w);
}
