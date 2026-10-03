import assert from 'node:assert/strict';
import {SharedStateSync} from '../../src/lib/sync/sharedState';
import {repairOperationalCache,operationalRecovery} from '../../src/lib/sync/operationalRecovery';
import {syncStatusModel} from '../../src/lib/sync/statusModel';
import {operationalScopeIssue} from '../../src/lib/sync/operationalScope';
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
// Screenshot regression: categories/tables were previously missed although
// products were already quarantined. Names cannot be used as scope evidence.
const layoutRows=[{kind:'categories',id:'cat-ld-1',name:'Renamed category'},
  {kind:'tables',id:'tbl-ld-m1',name:'Renamed washer'},
  {kind:'tables',id:'tbl-ld-d1',name:'Renamed dryer'},
  {kind:'tables',id:'tbl-ld-4',name:'Loker B-01',activeOrder:{id:'LND-203',totalAmount:64000}}];
for(const row of layoutRows){
  assert.equal(operationalScopeIssue('owner','FNB',row.kind,row.id,row),'WRONG_SECTOR:LAUNDRY');
  assert.equal(operationalScopeIssue('owner','LAUNDRY',row.kind,row.id,row),null);
  const before=JSON.stringify([row]);disk.set(`newhope_data_layout_FNB_${row.kind}`,before);
  assert.deepEqual(repairOperationalCache('layout','FNB',row.kind,[row]),[]);
  assert.ok(operationalRecovery('layout','FNB').some(backup=>backup.raw===before));
}
assert.equal(operationalScopeIssue('owner','FNB','tables','custom-id',{name:'Mesin Washer Laundry'}),null,'A name is not proof of sector');
assert.equal(operationalScopeIssue('owner','FNB','products','custom-id',{categoryId:'cat-ld-1'}),'WRONG_SECTOR:LAUNDRY');
assert.equal(operationalScopeIssue('owner','FNB','held_orders','hold',{items:[{product:{id:'prod-ld-12'}}]}),'WRONG_SECTOR:LAUNDRY');
assert.equal(operationalScopeIssue('owner','FNB','orders','ledger',{productId:'prod-ld-12'}),null,'Never quarantine financial ledger through operational repair');
cloud=layoutRows.map(row=>({scope:'FNB',kind:row.kind,recordId:row.id,value:row,revision:1,deleted:false}));
disk.set('newhope_shared_outbox_layout_FNB',JSON.stringify(layoutRows.map(row=>({kind:row.kind,recordId:row.id,value:row,baseRevision:0,deleted:false}))));
Object.defineProperty(globalThis,'fetch',{configurable:true,value:async()=>({ok:true,json:async()=>({ok:true,ready:true,records:cloud})})});
const layout=new SharedStateSync('layout','FNB',rows=>{visible=rows;},v=>{status=v;});
assert.equal(status.pending,0);await layout.refresh(true);assert.equal(visible.length,0);
for(const row of layoutRows){assert.ok(layout.legacyQuarantined(row.kind,row.id));layout.importLegacy(row.kind,[row]);}
assert.equal(status.pending,0,'Cloud/local/outbox copies cannot re-import the contaminated layout');layout.stop();
for(const [k,v]of finance)assert.equal(disk.get(k),v);
console.log('PASS: Laundry-in-FNB quarantine+backup, old arrays, latest edit/reload, 60/61 ACK, mixed lanes, lost ACK, no zombies, backup failure and proven foreign legacy CRM');
// 100 compressed product photos must split below the serverless body budget.
// One oversized old record remains reviewable, not silently deleted or allowed
// to reject otherwise-valid records in the same batch.
const payloadSizes:number[]=[];
Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(_url:string,options?:any)=>{
  if(!options?.body)return {ok:true,json:async()=>({ok:true,ready:true,records:[]})};
  payloadSizes.push(new TextEncoder().encode(options.body).byteLength);
  const sent=JSON.parse(options.body).operations;
  assert.ok(sent.every((op:any)=>JSON.stringify(op.value).length<=64000));
  return {ok:true,json:async()=>({ok:true,versions:sent.map((op:any)=>({kind:op.kind,recordId:op.recordId,revision:1}))})};
}});
const photoSync=new SharedStateSync('photo-budget','FNB',()=>{},value=>{status=value;});
await photoSync.refresh(true);photoSync.prime('products',[]);
photoSync.track('products',[{id:'oversized',name:'Preserve original',image:'x'.repeat(65000)},...Array.from({length:100},(_,i)=>({id:'photo-'+i,name:'Photo '+i,image:'data:image/jpeg;base64,'+'a'.repeat(39900)}))]);
for(let i=0;i<4&&status.pending>1;i++)await photoSync.flush();
assert.equal(status.pending,1);assert.equal(status.conflicts[0].error,'OPERATIONAL_RECORD_TOO_LARGE');
assert.ok(payloadSizes.length>=2);assert.ok(payloadSizes.every(size=>size<2800000));
assert.ok(disk.get('newhope_shared_outbox_photo-budget_FNB')?.includes('Preserve original'));
photoSync.stop();for(const [k,v]of finance)assert.equal(disk.get(k),v);
console.log('PASS: photo batch body budget, per-record oversized review, unrelated ACKs, original payload retained');
