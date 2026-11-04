import type {FinancialWorkspace} from './queue';
export interface RegisterCloseCommand{businessId:string;outletId:string;moduleId:string;registerId:string;clientShiftId:string;clientCloseId:string;expectedVersion:string;actualCash:number;notes:string}
type Stored={actorRef:string;command:RegisterCloseCommand;recountRequired?:boolean};
const key=(w:FinancialWorkspace,registerId:string)=>`newhope_shift_close_v1_${w.tenantId}_${w.merchantId}_${w.outletId}_${registerId}_${w.actorRef}`;
export const registerPreferenceKey=(w:FinancialWorkspace)=>`newhope_register_selection_v1_${w.tenantId}_${w.merchantId}_${w.outletId}_${w.moduleId}_${w.actorRef}`;
export const readRegisterPreference=(w:FinancialWorkspace)=>localStorage.getItem(registerPreferenceKey(w))||undefined;
export function saveRegisterPreference(w:FinancialWorkspace,id:string){if(id)localStorage.setItem(registerPreferenceKey(w),id);else localStorage.removeItem(registerPreferenceKey(w));window.dispatchEvent(new Event('financial-updated'));}
export function pendingRegisterClose(w:FinancialWorkspace,registerId:string):Stored|null{
 const raw=localStorage.getItem(key(w,registerId));if(!raw)return null;const row=JSON.parse(raw) as Stored;
 if(row.actorRef!==w.actorRef||row.command.businessId!==w.merchantId||row.command.outletId!==w.outletId||row.command.registerId!==registerId)throw Error('SHIFT_CLOSE_QUEUE_SCOPE_MISMATCH');return row;
}
export function enqueueRegisterClose(w:FinancialWorkspace,command:RegisterCloseCommand){
 if(command.businessId!==w.merchantId||command.outletId!==w.outletId||command.moduleId!==w.moduleId)throw Error('SHIFT_CLOSE_QUEUE_SCOPE_MISMATCH');
 const prior=pendingRegisterClose(w,command.registerId);if(prior){if(JSON.stringify(prior.command)!==JSON.stringify(command))throw Error('SHIFT_CLOSE_PENDING_RETRY_REQUIRED');return;}
 localStorage.setItem(key(w,command.registerId),JSON.stringify({actorRef:w.actorRef,command}));
}
export async function flushRegisterClose(w:FinancialWorkspace,registerId:string){
 const stored=pendingRegisterClose(w,registerId);if(!stored)return null;
 if(!navigator.onLine)throw Error('SHIFT_CLOSE_WAITING_FOR_NETWORK');
 const response=await fetch('/api/v1/finance/shift/close',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(stored.command),signal:AbortSignal.timeout(15000)});const data=await response.json();
 if(!response.ok||!data.ok){if(response.status===409&&data.error==='DRAWER_CHANGED_RECOUNT_REQUIRED')localStorage.setItem(key(w,registerId),JSON.stringify({...stored,recountRequired:true}));throw Error(data.error||'SHIFT_CLOSE_NOT_CONFIRMED');}
 const s=data.shift,c=stored.command;
 if(!s||s.status!=='CLOSED'||s.id!==c.clientShiftId||s.registerId!==c.registerId||s.actualCash!==Math.round(c.actualCash*100)/100||s.notes!==c.notes.trim())throw Error('SHIFT_CLOSE_ACK_MISMATCH');
 if(pendingRegisterClose(w,registerId)?.command.clientCloseId===c.clientCloseId)localStorage.removeItem(key(w,registerId));window.dispatchEvent(new Event('financial-updated'));return s;
}
/** Only an explicit server rejection proves the old request did not close the shift. */
export function archiveRecountRequiredClose(w:FinancialWorkspace,registerId:string){
 const prior=pendingRegisterClose(w,registerId);if(!prior?.recountRequired)throw Error('SHIFT_CLOSE_UNCONFIRMED_CANNOT_REPLACE');
 const archiveKey=key(w,registerId)+'_review_archive',rows=JSON.parse(localStorage.getItem(archiveKey)||'[]');rows.push(prior);localStorage.setItem(archiveKey,JSON.stringify(rows));localStorage.removeItem(key(w,registerId));
}
