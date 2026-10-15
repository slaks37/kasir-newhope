// Read-only browser helper. No network, token reads, queue mutation or localStorage writes.
// Import on a locally served operator page, or paste the exported function body
// into the device's DevTools after review. Keep the returned receipt private.
export async function inspectDeviceOutboxes(storage,hash){
 const types=[['newhope_sync_queue_','sales'],['newhope_cash_outbox_','cash'],['newhope_sync_quarantine_','quarantine'],['newhope_shared_outbox_','operational'],['newhope_retired_financial_outbox_','retiredFinancial'],['newhope_legacy_financial_holds_','financialHolds']];
 const entries=[],errors=[];
 for(let i=0;i<storage.length;i++){
  const key=storage.key(i),type=types.find(([prefix])=>key?.startsWith(prefix));if(!type)continue;
  let raw;try{raw=storage.getItem(key);if(typeof raw!=='string')throw Error('MISSING_VALUE');const v=JSON.parse(raw);let count,conflicts=0;
   if(type[1]==='operational'){
    if(Array.isArray(v))count=v.length;else if(v&&Array.isArray(v.operations)&&(!Object.hasOwn(v,'conflicts')||Array.isArray(v.conflicts))){count=v.operations.length;conflicts=v.conflicts?.length||0;}else throw Error('INVALID_OPERATIONAL_QUEUE');
   }else if(type[1]==='financialHolds'){
    if(!v||!Array.isArray(v.orders)||!Array.isArray(v.cash_movements))throw Error('INVALID_HOLDS');count=v.orders.length+v.cash_movements.length;
   }else{if(!Array.isArray(v))throw Error('INVALID_QUEUE');count=v.length;}
   entries.push({kind:type[1],scopeKeySha256:await hash(key),payloadSha256:await hash(raw),pendingOrHeld:count,conflicts});
  }catch{errors.push({kind:type[1],scopeKeySha256:await hash(key),code:'UNREADABLE_QUEUE_PRESERVE_ORIGINAL'});}
 }
 return {format:'newhope-device-checkpoint-v1',capturedAt:new Date().toISOString(),entries,errors,pendingOrHeld:entries.reduce((n,e)=>n+e.pendingOrHeld+e.conflicts,0),status:errors.length?'UNREADABLE_BLOCKER':entries.some(e=>e.pendingOrHeld||e.conflicts)?'PENDING_BLOCKER':'LOCAL_QUEUES_EMPTY_AT_OBSERVATION',deviceInventoryComplete:false,inFlightRequestAcknowledgementVerified:false,serverAcknowledgementsReconciled:false,cutoverAllowed:false,scope:'One browser profile and origin only; unknown devices, memory-only requests, unsaved checkout and provider queues are not observable; no customer/token data returned'};
}
