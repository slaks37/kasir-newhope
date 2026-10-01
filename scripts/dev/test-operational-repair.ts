import assert from 'node:assert/strict';
import {SharedStateSync} from '../../src/lib/sync/sharedState';
import {repairOperationalCache,operationalRecovery} from '../../src/lib/sync/operationalRecovery';
import {syncStatusModel} from '../../src/lib/sync/statusModel';
const disk=new Map<string,string>();let failBackup=false;
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>disk.get(k)||null,setItem:(k:string,v:string)=>{if(failBackup&&k.includes('recovery_v2'))throw Error('quota');disk.set(k,v);}}});
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
const op=(id:string,name=id)=>({kind:'products',recordId:id,baseRevision:0,deleted:false,value:{id,name,price:100,costPrice:20}});
const key='newhope_shared_outbox_owner_FNB',cache='newhope_data_owner_FNB_products';
const wrong=op('prod-ld-12','Cleaning & Sanitasi Helm Fullface'),right=op('prod-fnb-1');
disk.set('newhope_transaction_queue_owner_FNB','[financial bytes]');disk.set('newhope_recovery_snapshot_owner_FNB','[snapshot bytes]');
const finance=[...disk];disk.set(key,JSON.stringify([right,wrong,{...right,value:{...right.value,name:'Latest'}}]));
disk.set(cache,JSON.stringify([right.value,wrong.value]));
let status:any,visible:any[]=[];
let posts=0,cloud:any[]=[];
Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(_url:string,options?:any)=>{
  if(!options?.body)return {ok:true,json:async()=>({ok:true,ready:true,scopeProof:true,records:cloud})};
  posts++;const sent=JSON.parse(options.body).operations;
  const conflicts=sent.filter((o:any)=>o.recordId==='conflict').map((o:any)=>({kind:o.kind,recordId:o.recordId,error:'STATE_CONFLICT'}));
  const versions=sent.filter((o:any)=>o.recordId!=='conflict').map((o:any)=>{cloud.push({scope:'FNB',...o,revision:1});return {kind:o.kind,recordId:o.recordId,revision:1};});
  return {ok:true,json:async()=>({ok:true,versions,conflicts})};
}});
const a=new SharedStateSync('owner','FNB',rows=>{visible=rows;},v=>{status=v;});
assert.equal(status.pending,1);assert.equal(status.quarantined,1);
assert.equal(JSON.parse(disk.get(key)!).operations[0].value.name,'Latest');
assert.equal(repairOperationalCache('owner','FNB','products',JSON.parse(disk.get(cache)!)).length,1);
assert.ok(operationalRecovery('owner','FNB').some(b=>b.raw.includes('Cleaning & Sanitasi Helm Fullface')));
for(const [k,v]of finance)assert.equal(disk.get(k),v,'Financial queues/snapshots remain byte-identical');
a.stop();
const reload=new SharedStateSync('owner','FNB',rows=>{visible=rows;},v=>{status=v;});
assert.equal(status.pending,1,'Reload retains the latest pending operation');
await reload.refresh(true);assert.equal(status.pending,0);assert.equal(posts,1);reload.stop();
// Old arrays, repeated edits and partial batch acknowledgment.
cloud=[];disk.set(key,'[]');const b=new SharedStateSync('owner','FNB',()=>{},v=>{status=v;});
await b.refresh(true);b.prime('tables',[]);
b.track('tables',[{id:'same',name:'v1'}]);b.track('tables',[{id:'same',name:'v2'}]);
assert.equal(status.pending,1);assert.equal(JSON.parse(disk.get(key)!).operations[0].value.name,'v2');
await b.flush();b.prime('tables',[]);
b.track('tables',Array.from({length:61},(_,i)=>({id:i===0?'conflict':'table-'+i,name:'Table '+i})));
await b.flush();assert.equal(status.pending,1,'Only the conflicting operation remains');assert.equal(status.conflicts.length,1);
assert.equal(cloud.filter(r=>r.recordId.startsWith('table-')).length,60);b.stop();
const combined=syncStatusModel({businessId:'owner_FNB',financial:{pending:1,failures:0,inFlight:false,lastError:null,lastSyncedAt:null} as any,
  operational:status,recovery:null,cloudReady:true,cloudError:null,online:true});
assert.equal(combined.phase,'review');assert.equal(combined.financialPending,1);assert.equal(combined.operationalConflicts.length,1);
// Lost server ACK: semantic JSON equality ACKs without resending or duplicate records.
cloud=[{scope:'FNB',kind:'products',recordId:'p-ack',revision:5,deleted:false,value:{costPrice:20,name:'p-ack',id:'p-ack',price:100}}];
disk.set(key,JSON.stringify([op('p-ack')]));const calls=posts;
const ack=new SharedStateSync('owner','FNB',()=>{},v=>{status=v;});await ack.refresh(true);
assert.equal(status.pending,0);assert.equal(posts,calls);ack.stop();
// Missing cloud record must not survive subsequent complete hydration.
disk.set(key,'[]');const zombie=new SharedStateSync('owner','FNB',rows=>{visible=rows;},()=>{});await zombie.refresh(true);
assert.equal(visible.length,1);cloud=[];await zombie.refresh(false);assert.equal(visible.length,0);zombie.stop();
// A failed backup must leave original wrong-scope data intact and block uploads.
const bytes=JSON.stringify([wrong]);disk.set('newhope_shared_outbox_quota_FNB',bytes);failBackup=true;
const quota=new SharedStateSync('quota','FNB',()=>{throw Error('must not hydrate');},v=>{status=v;});
await quota.refresh(true);await quota.flush();assert.match(status.error,/OPERATIONAL_QUEUE_REPAIR_FAILED/);
assert.equal(disk.get('newhope_shared_outbox_quota_FNB'),bytes);quota.stop();failBackup=false;
const oldCustomer={kind:'customers',recordId:'cust-11111111-2222-3333-4444-555555555555',baseRevision:0,deleted:false,value:{id:'cust-11111111-2222-3333-4444-555555555555',name:'Old customer'}};
disk.set(key,JSON.stringify([oldCustomer]));disk.set('newhope_data_owner_FNB_customers',JSON.stringify([oldCustomer.value]));
Object.defineProperty(globalThis,'fetch',{configurable:true,value:async()=>({ok:true,json:async()=>({ok:true,ready:true,scopeProof:true,records:[],
  foreignRecords:[{...oldCustomer,scope:'LAUNDRY',value:{...oldCustomer.value,visitCount:5}}]})})});
const contaminated=new SharedStateSync('owner','FNB',()=>{},v=>{status=v;});await contaminated.refresh(true);
assert.equal(status.pending,0);assert.ok(contaminated.legacyQuarantined('customers',oldCustomer.recordId));
contaminated.importLegacy('customers',[oldCustomer.value]);assert.equal(status.pending,0,'A quarantined legacy cache cannot re-import itself');
assert.ok(operationalRecovery('owner','FNB').some(b=>b.records.some(r=>r.reason==='OTHER_CONFIRMED_SECTOR:LAUNDRY')));
for(const [k,v]of finance)assert.equal(disk.get(k),v);contaminated.stop();
assert.deepEqual(repairOperationalCache('owner','FNB','store_settings',{id:'main',storeMode:'SERVICE'}),{},'Incompatible sector mode is backed up before removal');
console.log('PASS: Laundry-in-FNB quarantine+backup, old arrays, latest edit/reload, 60/61 ACK, mixed lanes, lost ACK, no zombies, backup failure and proven foreign legacy CRM');
