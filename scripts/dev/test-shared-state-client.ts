import assert from 'node:assert/strict';
import { SharedStateSync } from '../../src/lib/sync/sharedState';

const disk=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{value:{
  getItem:(key:string)=>disk.get(key)||null,
  setItem:(key:string,value:string)=>{disk.set(key,value);},
}});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
Object.defineProperty(globalThis,'window',{value:{setTimeout,clearTimeout,setInterval,clearInterval},configurable:true});
let record:{revision:number;value:any}|undefined;
Object.defineProperty(globalThis,'fetch',{value:async (_url:string,options?:{body?:string})=>{
  if(!options?.body)return {ok:true,json:async()=>({ok:true,ready:true,records:record?[{scope:'FNB',kind:'tables',recordId:'table-1',value:record.value,revision:record.revision,deleted:false}]:[]})};
  const body=JSON.parse(options.body),operation=body.operations[0];
  if(operation.baseRevision!==(record?.revision||0))return {ok:false,status:409,json:async()=>({ok:false,error:'STATE_CONFLICT',kind:operation.kind,recordId:operation.recordId})};
  record={revision:(record?.revision||0)+1,value:operation.value};
  return {ok:true,json:async()=>({ok:true,versions:[{kind:operation.kind,recordId:operation.recordId,revision:record.revision}]})};
},configurable:true});

let statusA:any,statusB:any;
const a=new SharedStateSync('owner','FNB',()=>{},value=>{statusA=value;});
const b=new SharedStateSync('owner-other-device','FNB',()=>{},value=>{statusB=value;});
// Give the two simulated devices independent durable outboxes but one server.
a.prime('tables',[]);b.prime('tables',[]);
await a.refresh(true);await b.refresh(true);
a.track('tables',[{id:'table-1',name:'Meja A'}]);
assert.equal(statusA.pending,1);
assert.equal(JSON.parse(disk.get('newhope_shared_outbox_owner_FNB')||'[]').length,1);
await a.flush();
assert.equal(statusA.pending,0);
b.track('tables',[{id:'table-1',name:'Meja B'}]);
await b.flush();
assert.equal(statusB.pending,1,'Conflicting change stays in the durable outbox');
assert.match(statusB.error,/Konflik data/);
assert.equal(record?.value.name,'Meja A','Server did not accept stale device B state');
a.stop();b.stop();
console.log('PASS: operational edits persist locally, acknowledge per record and retain conflicts without overwriting');
