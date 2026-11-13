/** Transactional device-local journal. Not a replacement ledger, and not yet enabled for native checkout. */
export type CommandScope={tenantId:string;merchantId:string;outletId:string;moduleId:string;actorRef:string;deviceId:string};
export type DurableCommand={id:string;scope:CommandScope;payload:string;createdAt:number};
const scopeKey=(s:CommandScope)=>JSON.stringify([s.tenantId,s.merchantId,s.outletId,s.moduleId,s.actorRef,s.deviceId]);
const key=(c:Pick<DurableCommand,'scope'|'id'>)=>scopeKey(c.scope)+':'+c.id;
export async function openCommandStore(name='newhope-native-commands-v1'){
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('commands');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 function transaction<T>(mode:IDBTransactionMode,work:(s:IDBObjectStore,done:(value:T)=>void)=>void):Promise<T>{return new Promise((resolve,reject)=>{
  const tx=db.transaction('commands',mode,{durability:'strict'});let value:T;
  tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error||Error('COMMAND_TRANSACTION_ABORTED'));tx.onerror=()=>reject(tx.error);
  try{work(tx.objectStore('commands'),v=>{value=v;});}catch(e){tx.abort();reject(e);}
 });}
 return {
  close:()=>db.close(),
  enqueue:(command:DurableCommand)=>transaction<void>('readwrite',(s,done)=>{
   if(!command.id||Object.values(command.scope).some(v=>typeof v!=='string'||!v))throw Error('COMMAND_SCOPE_REQUIRED');
   const r=s.get(key(command));r.onsuccess=()=>{if(r.result&&JSON.stringify(r.result)!==JSON.stringify(command)){s.transaction.abort();return;}s.put(command,key(command));done();};
  }),
  list:(scope:CommandScope)=>transaction<DurableCommand[]>('readonly',(s,done)=>{const r=s.getAll();r.onsuccess=()=>done(r.result.filter((c:DurableCommand)=>scopeKey(c.scope)===scopeKey(scope)));}),
  acknowledge:(command:DurableCommand,acceptedId:string)=>transaction<void>('readwrite',(s,done)=>{
   if(acceptedId!==command.id)throw Error('ACK_ID_MISMATCH');const r=s.get(key(command));r.onsuccess=()=>{if(!r.result||JSON.stringify(r.result)!==JSON.stringify(command)){s.transaction.abort();return;}s.delete(key(command));done();};
  }),
 };
}
