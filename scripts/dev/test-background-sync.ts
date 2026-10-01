import assert from 'node:assert/strict';
import {SharedStateSync} from '../../src/lib/sync/sharedState';
import {recoveryGroups,type OperationalRecovery} from '../../src/lib/sync/operationalRecovery';
const disk=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{value:{getItem:(key:string)=>disk.get(key)||null,setItem:(key:string,value:string)=>disk.set(key,value)}});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
let timerId=0;const timers=new Map<number,{run:()=>void;delay:number}>();
Object.defineProperty(globalThis,'setTimeout',{value:(run:()=>void,delay:number)=>{timers.set(++timerId,{run,delay});return timerId;},configurable:true});
Object.defineProperty(globalThis,'clearTimeout',{value:(id:number)=>timers.delete(id),configurable:true});
let attempts=0,reads=0,cloud:any[]=[];
Object.defineProperty(globalThis,'fetch',{value:async(_url:string,options?:any)=>{
  if(!options?.body){reads++;return {ok:true,json:async()=>({ok:true,ready:true,scopeProof:true,records:cloud})};}
  attempts++;if(attempts===1)throw Error('temporary connection loss');
  const operations=JSON.parse(options.body).operations;
  cloud=operations.map((op:any)=>({...op,scope:'FNB',revision:1}));
  return {ok:true,json:async()=>({ok:true,versions:cloud.map(r=>({kind:r.kind,recordId:r.recordId,revision:r.revision}))})};
},configurable:true});
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
disk.set('newhope_shared_outbox_owner_FNB',JSON.stringify([{kind:'tables',recordId:'t1',value:{id:'t1',name:'Table'},deleted:false,baseRevision:0}]));
let state:any;
const sync=new SharedStateSync('owner','FNB',()=>{},value=>{state=value;});
sync.start();await settle();
assert.equal(attempts,1,'Startup sends pending data without a user action');assert.equal(state.pending,1);
const retry=[...timers.values()].find(t=>t.delay===6000)!;assert.ok(retry);retry.run();await settle();
assert.equal(attempts,2,'Background retry sends after a transient failure');assert.equal(state.pending,0);
assert.equal(cloud[0].value.name,'Table');assert.equal(reads,2);sync.stop();
// A slow read must finish before the next poll is scheduled.
let finish:(value:any)=>void=()=>{};
Object.defineProperty(globalThis,'fetch',{value:()=>new Promise(resolve=>{finish=resolve;}),configurable:true});
timers.clear();const slow=new SharedStateSync('slow','FNB',()=>{},()=>{});slow.start();await settle();
assert.equal(timers.size,0,'No polling while hydration is still in flight');
finish({ok:true,json:async()=>({ok:true,ready:true,records:[]})});await settle();assert.equal(timers.size,1);slow.stop();
const snapshot=(sourceKey:string):OperationalRecovery=>({sourceKey,raw:'original',capturedAt:'2026-10-01',records:[{kind:'products',recordId:'prod-ld-12',name:'Helm',reason:'WRONG_SECTOR:LAUNDRY'}]});
const snapshots=[snapshot('cache'),snapshot('outbox')],before=JSON.stringify(snapshots);
const grouped=recoveryGroups(snapshots);assert.equal(grouped.length,1);assert.equal(grouped[0].sources.length,2);
assert.equal(JSON.stringify(snapshots),before,'Grouping is presentation only; all original recovery bytes retained');
console.log('PASS: automatic startup/retry, serial slow hydration and deduplicated recovery presentation');
