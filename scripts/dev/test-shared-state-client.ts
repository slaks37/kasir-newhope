import assert from 'node:assert/strict';
import { SharedStateSync } from '../../src/lib/sync/sharedState';

const diskA=new Map<string,string>(),diskB=new Map<string,string>(),diskC=new Map<string,string>();
let disk=diskA;
Object.defineProperty(globalThis,'localStorage',{value:{
  getItem:(key:string)=>disk.get(key)||null,
  setItem:(key:string,value:string)=>{disk.set(key,value);},
}});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
Object.defineProperty(globalThis,'window',{value:{setTimeout,clearTimeout,setInterval,clearInterval},configurable:true});
let record:{revision:number;value:any}|undefined;
let outletBlocked=false,postCalls=0;
Object.defineProperty(globalThis,'fetch',{value:async (_url:string,options?:{body?:string})=>{
  if(!options?.body)return {ok:true,json:async()=>({ok:true,ready:true,records:record?[{scope:'FNB',kind:'tables',recordId:'table-1',value:record.value,revision:record.revision,deleted:false}]:[]})};
  postCalls++;
  if(outletBlocked)return {ok:false,status:409,json:async()=>({ok:false,error:'OUTLET_SETUP_REQUIRED'})};
  const body=JSON.parse(options.body),operation=body.operations[0];
  if(operation.baseRevision!==(record?.revision||0))return {ok:false,status:409,json:async()=>({ok:false,error:'STATE_CONFLICT',kind:operation.kind,recordId:operation.recordId})};
  record={revision:(record?.revision||0)+1,value:operation.value};
  return {ok:true,json:async()=>({ok:true,versions:[{kind:operation.kind,recordId:operation.recordId,revision:record.revision}]})};
},configurable:true});

let statusA:any,statusB:any;
const a=new SharedStateSync('owner','FNB',()=>{},value=>{statusA=value;});
disk=diskB;
const b=new SharedStateSync('owner','FNB',()=>{},value=>{statusB=value;});
// Give the two simulated devices independent durable outboxes but one server.
a.prime('tables',[]);b.prime('tables',[]);
await a.refresh(true);await b.refresh(true);
disk=diskA;
a.track('tables',[{id:'table-1',name:'Meja A'}]);
assert.equal(statusA.pending,1);
assert.equal(JSON.parse(diskA.get('newhope_shared_outbox_owner_FNB')||'[]').length,1);
await a.flush();
assert.equal(statusA.pending,0);
disk=diskC;
let readback:any[]=[];
const fresh=new SharedStateSync('owner','FNB',rows=>{readback=rows;},()=>{});
await fresh.refresh(true);
assert.equal(readback.find(row=>row.kind==='tables'&&row.recordId==='table-1')?.value.name,'Meja A',
  'A second terminal must hydrate the owner\'s confirmed cloud record');
fresh.stop();
disk=diskB;
b.track('tables',[{id:'table-1',name:'Meja B'}]);
await b.flush();
assert.equal(statusB.pending,1,'Conflicting change stays in the durable outbox');
assert.match(statusB.error,/Konflik data/);
assert.equal(record?.value.name,'Meja A','Server did not accept stale device B state');
a.stop();b.stop();
record=undefined;
outletBlocked=true;
let statusC:any;
disk=diskC;
const c=new SharedStateSync('blocked-owner','CARWASH',()=>{},value=>{statusC=value;});
c.prime('products',[]);
await c.refresh(true);
c.track('products',[{id:'product-1',name:'Cuci Mobil',price:100,costPrice:30}]);
await c.flush();
const callsWhileBlocked=postCalls;
await c.refresh(false);
await c.flush();
assert.equal(postCalls,callsWhileBlocked,'Blocked outlet must not be retried every poll');
assert.equal(statusC.pending,1);
assert.match(statusC.error,/Outlet belum aktif/);
outletBlocked=false;
await c.resumeAfterOutletUpdate();
assert.equal(statusC.pending,0,'Pending product is retried after outlet activation');
c.stop();
console.log('PASS: operational edits persist locally, acknowledge per record and retain conflicts without overwriting');
