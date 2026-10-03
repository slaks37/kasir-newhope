import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {migrateLegacyFinancialData} from '../../src/lib/sync/legacyMigration';
import {flush,getPendingTransactions,orderToPayload,enqueue,type SyncTarget} from '../../src/lib/sync/queue';
import {flushCashQueue,enqueueCashCommand,pendingRefund,refundAcknowledgment} from '../../src/lib/sync/financialQueue';
import {orderOperations,mergeOrderOperations} from '../../src/lib/sync/orderOperations';
import type {Order} from '../../src/types';
const disk=new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{value:{getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>disk.set(key,value),
  get length(){return disk.size;},key:(index:number)=>[...disk.keys()][index]??null},configurable:true});
const owner=randomUUID(),outlet=randomUUID();
const target:SyncTarget={ownerRef:owner,businessId:owner+'_FNB',sector:'FNB',outletId:outlet,storeName:'Owner store'};
const sale={id:'legacy-1',userId:owner,date:'2026-09-29T10:00:00Z',businessSector:'FNB',branchId:'legacy-branch',
  status:'COMPLETED',paymentStatus:'PAID',subtotal:70000,discountTotal:30000,taxTotal:7000,serviceChargeTotal:3500,total:80500,
  paymentMethod:'CASH',cashierName:'Owner',items:[{id:'line-1',productId:'p-1',name:'Product',unitPrice:50000,unitCost:10000,quantity:2,totalPrice:70000,discountAmount:30000}]} as Order;
const source='newhope_data_'+target.businessId+'_orders';
const original=JSON.stringify([sale]);disk.set(source,original);
disk.set('newhope_data_'+target.businessId+'_cash_movements',JSON.stringify([{id:'cash-legacy',branchId:'legacy-branch',amount:5000,type:'CASH_OUT',category:'OPERASIONAL',description:'Old expense',timestamp:'2026-09-29T10:00:00Z',cashierName:'Owner'}]));
const foreignSource='newhope_data_'+randomUUID()+'_FNB_orders',foreignRaw=JSON.stringify([{...sale,id:'other-owner'}]);
disk.set(foreignSource,foreignRaw);
let migration=migrateLegacyFinancialData(target);
assert.equal(migration.needsOutletMapping,2);assert.deepEqual(migration.unmappedOutletRefs,['legacy-branch']);
assert.equal(getPendingTransactions(target.businessId)[0].branchId,'legacy-branch','Never default historical outlet to currently selected outlet');
assert.equal(orderToPayload(sale).subtotal,100000,'Normalize known net-subtotal layout without changing amount paid');
const calls:any[]=[];
Object.defineProperty(globalThis,'fetch',{value:async(_url:string,options:any)=>{const body=JSON.parse(options.body);calls.push(body);return {ok:true,status:200,json:async()=>({ok:true,accepted:body.transactions?.length||0,duplicates:0,refund:{amount:5000,subtotal:5000,tax:0,service:0}})};},configurable:true});
migration=migrateLegacyFinancialData(target,{outletMappings:{'legacy-branch':outlet}});
assert.equal(migration.queued,1);assert.equal(migration.needsOutletMapping,0);
await flush(target,true);await flushCashQueue(target,true);
migration=migrateLegacyFinancialData(target,{outletMappings:{'legacy-branch':outlet}});
assert.equal(migration.acknowledged,1);assert.equal(migration.complete,true);
assert.equal(disk.get(source),original,'Original source is preserved after cloud acknowledgment');
disk.set(source,'[]');
assert.equal(migrateLegacyFinancialData(target,{outletMappings:{'legacy-branch':outlet}}).acknowledged,1,'Reload uses retained original snapshot, not replaced cache');
assert.equal(calls.length,2);assert.equal(calls[0].outletId,outlet);
assert.equal(disk.get(foreignSource),foreignRaw,'Never modify another owner source');
const parse=JSON.parse;let sourceParses=0;
JSON.parse=((raw:string,...args:any[])=>{if(raw===original||raw===disk.get('newhope_legacy_financial_v1_'+target.businessId))sourceParses++;return (parse as any)(raw,...args);}) as typeof JSON.parse;
try{
  assert.equal(migrateLegacyFinancialData(target,{outletMappings:{'legacy-branch':outlet}}).complete,true);
  assert.equal(sourceParses,0,'Already acknowledged recovery does not reparse the entire laptop snapshot every refresh');
}finally{JSON.parse=parse;}
// Losing an ACK changes no key count. A volatile fast path must still notice
// and replay idempotently; a completed flag alone is never financial evidence.
disk.set('newhope_legacy_financial_ack_'+target.businessId,'{}');
const afterAckLoss=migrateLegacyFinancialData(target,{outletMappings:{'legacy-branch':outlet}});
assert.equal(afterAckLoss.complete,false);assert.equal(afterAckLoss.queued,1);
await flush(target,true);
assert.equal(migrateLegacyFinancialData(target,{outletMappings:{'legacy-branch':outlet}}).complete,true);
assert.equal(disk.get('newhope_legacy_financial_v1_'+target.businessId)?.includes('legacy-1'),true,'ACK retry retains the original recovery snapshot');
const refund={action:'refund' as const,body:{sector:'FNB' as const,outletId:outlet,clientEventId:'refund-stable',clientTxnId:sale.id,
  refund:{clientRefundId:'refund-stable',occurredAt:'2026-10-01T10:00:00Z',refundMethod:'CASH' as const,reason:'Return',items:[{clientItemId:'line-1',quantity:1}]}}};
enqueueCashCommand(target.businessId,refund);assert.equal(pendingRefund(target.businessId,sale.id),true);
await flushCashQueue(target,true);assert.equal(pendingRefund(target.businessId,sale.id),false);assert.equal(refundAcknowledgment(target.businessId,'refund-stable').amount,5000);
const operational=orderOperations({...sale,laundryStage:'SETRIKA'});
assert.equal('total' in operational,false);assert.equal('paymentStatus' in operational,false);
assert.equal(mergeOrderOperations(sale,{...operational,total:0,paymentStatus:'CANCELLED'}).total,sale.total);
const badOwner=randomUUID();const badTarget={...target,ownerRef:badOwner,businessId:badOwner+'_FNB'};
const badSource='newhope_data_'+badTarget.businessId+'_orders';disk.set(badSource,'{corrupt original');
assert.equal(migrateLegacyFinancialData(badTarget).captured,false);assert.equal(disk.get(badSource),'{corrupt original');
const recoveredOwner=randomUUID(),recoveredTarget={...target,ownerRef:recoveredOwner,businessId:recoveredOwner+'_FNB'};
const retiredRaw=JSON.stringify([{kind:'orders',recordId:'retired-only',deleted:false,value:{...sale,id:'retired-only',branchId:outlet,userId:recoveredOwner}}]);
disk.set('newhope_retired_financial_outbox_'+recoveredOwner+'_FNB',retiredRaw);
assert.equal(migrateLegacyFinancialData(recoveredTarget).queued,1,'Recover financial outbox rows absent from the old receipt cache');
assert.equal(getPendingTransactions(recoveredTarget.businessId)[0].clientTxnId,'retired-only');
assert.equal(disk.get('newhope_retired_financial_outbox_'+recoveredOwner+'_FNB'),retiredRaw);
// Competing financial copies cannot silently send the original version, even
// when that version was already queued by an earlier migration pass.
const heldOwner=randomUUID(),heldTarget={...target,ownerRef:heldOwner,businessId:heldOwner+'_FNB'};
const heldSale={...sale,id:'held-sale',branchId:outlet,userId:heldOwner};
const heldSource='newhope_data_'+heldTarget.businessId+'_orders';
const heldRaw=JSON.stringify([heldSale]);disk.set(heldSource,heldRaw);
const heldCashSource='newhope_data_'+heldTarget.businessId+'_cash_movements';
const heldCash={id:'held-cash',branchId:outlet,amount:5000,type:'CASH_OUT',category:'OPERASIONAL',description:'Old expense',timestamp:'2026-09-29T10:00:00Z',cashierName:'Owner'};
disk.set(heldCashSource,JSON.stringify([heldCash]));
assert.equal(migrateLegacyFinancialData(heldTarget).queued,1);
disk.set('newhope_retired_financial_outbox_'+heldOwner+'_FNB',JSON.stringify([
  {kind:'orders',deleted:false,value:{...heldSale,total:heldSale.total+1000}},
  {kind:'cash_movements',deleted:false,value:{...heldCash,amount:6000}},
]));
const heldMigration=migrateLegacyFinancialData(heldTarget);
assert.equal(heldMigration.conflicts,2);assert.equal(heldMigration.queued,0);
assert.equal(heldMigration.reviewRecords.length,2);
const beforeHeldFlush=calls.length;
assert.equal((await flush(heldTarget,true)).lastError,'LEGACY_FINANCIAL_REVIEW_REQUIRED');
assert.equal((await flushCashQueue(heldTarget,true)).lastError,'LEGACY_FINANCIAL_REVIEW_REQUIRED');
assert.equal(calls.length,beforeHeldFlush,'Held migration copies must never reach the API');
assert.equal(getPendingTransactions(heldTarget.businessId).length,1,'Held queued command is retained');
assert.equal(disk.get(heldSource),heldRaw,'Original source bytes remain untouched');
enqueue(heldTarget.businessId,orderToPayload({...heldSale,id:'new-live-sale'}));
await flush(heldTarget,true);
assert.equal(calls.length,beforeHeldFlush+1,'A held legacy ID does not block unrelated new sales');
assert.equal(calls.at(-1).transactions[0].clientTxnId,'new-live-sale');
const equalOwner=randomUUID(),equalTarget={...target,ownerRef:equalOwner,businessId:equalOwner+'_FNB'};
const equalSale={...sale,id:'same-financial-copy',branchId:outlet,userId:equalOwner};
disk.set('newhope_data_'+equalTarget.businessId+'_orders',JSON.stringify([equalSale]));
disk.set('newhope_retired_financial_outbox_'+equalOwner+'_FNB',JSON.stringify([
  {kind:'orders',deleted:false,value:{laundryStage:'SETRIKA',...equalSale}},
]));
assert.equal(migrateLegacyFinancialData(equalTarget).conflicts,0,'Operational metadata must not create a false financial conflict');
assert.equal(getPendingTransactions(equalTarget.businessId).length,1);
console.log('PASS: one-time owner-scoped migration, explicit outlet mapping, durable ACK/reload, original-byte retention, refund outbox and non-financial overlays');
