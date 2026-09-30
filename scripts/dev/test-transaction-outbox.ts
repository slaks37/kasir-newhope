import assert from 'node:assert/strict';
import { enqueue, flush, getStatus, type SyncPayloadTxn, type SyncTarget } from '../../src/lib/sync/queue';

const disk = new Map<string,string>();
let rejectWrites = false;
Object.defineProperty(globalThis,'localStorage',{value:{
  getItem:(key:string)=>disk.get(key) ?? null,
  setItem:(key:string,value:string)=>{
    if(rejectWrites && key.startsWith('newhope_sync_queue_'))throw Error('quota exceeded');
    disk.set(key,value);
  },
},configurable:true});

const target:SyncTarget={businessId:'owner_CARWASH',sector:'CARWASH',storeName:'Demo',ownerRef:'owner'};
const sale:SyncPayloadTxn={clientTxnId:'sale-1',branchId:undefined,subtotal:100,discountAmount:0,
  taxAmount:0,serviceChargeAmount:0,totalAmount:100,paymentMethod:'CASH',paymentStatus:'COMPLETED',items:[]};
enqueue(target.businessId,sale);
assert.equal(getStatus(target.businessId).pending,1);

let calls=0;
Object.defineProperty(globalThis,'fetch',{value:async()=>{
  calls++;
  return {ok:false,status:409,json:async()=>({ok:false,error:'OUTLET_SETUP_REQUIRED'})};
},configurable:true});
await flush(target,true);
assert.equal(calls,1);
assert.equal(getStatus(target.businessId).pending,1,'A rejected sale must remain in its original queue');
await flush(target);
assert.equal(calls,1,'Outlet cap must pause automatic retries until an outlet update');

rejectWrites=true;
assert.throws(()=>enqueue(target.businessId,{...sale,clientTxnId:'sale-2'}),/LOCAL_QUEUE_WRITE_FAILED/);
assert.equal(getStatus(target.businessId).pending,1,'Failed disk write must not appear as a recorded sale');
rejectWrites=false;

const key=`newhope_sync_queue_${target.businessId}`;
disk.set(key,'{damaged original queue');
assert.equal(getStatus(target.businessId).lastError,'LOCAL_QUEUE_CORRUPT');
assert.throws(()=>enqueue(target.businessId,{...sale,clientTxnId:'sale-3'}),/LOCAL_QUEUE_CORRUPT/);
assert.equal(disk.get(key),'{damaged original queue','Recovery bytes must not be overwritten');
console.log('PASS: outbox writes fail visibly, damaged queues are preserved, outlet-blocked sales wait');
