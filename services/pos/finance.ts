import type { Express, Request } from 'express';
import type { Db } from '../shared/db';
import { trustedPrincipal, tenantForPrincipal } from '../shared/auth';
import { assertTenantWritable, BillingError } from '../billing/engine';
import { assertFreeScope, freePlanState, FreePlanAccessError } from '../billing/freePlan';
import { SECTORS, writeActivity, type Sector } from './activity';
import type { Shift } from '../../src/types';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID=/^[^\x00-\x1f\x7f]{1,128}$/;
const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export class FinanceError extends Error { constructor(readonly status:number,code:string){super(code);} }
export interface FinancialScope { tenantId:string; merchantId:string; outletId:string; sector:Sector; actorRef:string }
export interface RefundCommand {clientRefundId:string;occurredAt?:string;refundMethod:'CASH'|'ORIGINAL_METHOD';reason:string;items:Array<{clientItemId:string;quantity:number}>}
function timestamp(value:unknown):string {
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new FinanceError(400,'INVALID_EVENT_DATE');
  return new Date(value).toISOString();
}
async function scopeFor(db:Db,req:Request):Promise<FinancialScope>{
  const input=req.method==='GET'?req.query:req.body;
  const principal=trustedPrincipal(req), sector=input?.sector,outletId=input?.outletId;
  if(!principal||principal.subject==='local-development')throw new FinanceError(401,'UNAUTHENTICATED');
  if(!(SECTORS as readonly string[]).includes(sector)||!UUID.test(String(outletId)))throw new FinanceError(400,'INVALID_FINANCIAL_SCOPE');
  const tenantId=await tenantForPrincipal(db,principal);
  if(!tenantId)throw new FinanceError(409,'TENANT_NOT_PROVISIONED');
  const row=(await db.query(`SELECT o.merchant_id,o.is_active FROM internal.outlets o JOIN internal.merchants m
    ON m.id=o.merchant_id AND m.tenant_id=o.tenant_id
    WHERE o.id=$1 AND o.tenant_id=$2 AND m.business_sector=$3`,[outletId,tenantId,sector])).rows[0];
  if(!row)throw new FinanceError(403,'OUTLET_NOT_OWNED');
  if(!row.is_active)throw new FinanceError(409,'OUTLET_SETUP_REQUIRED');
  await assertTenantWritable(db,tenantId);
  const free=await freePlanState(db,tenantId);assertFreeScope(free,sector,[]);
  if(free.free&&free.selection?.branchId!==outletId)throw new FinanceError(403,'FREE_OUTLET_MISMATCH');
  await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)",[tenantId,row.merchant_id]);
  return {tenantId,merchantId:row.merchant_id,outletId,sector,actorRef:principal.subject};
}

/** Caller must use a database transaction. Locks serialize refund/void/retry. */
export async function applyRefund(db:Db,scope:FinancialScope,transactionId:string,command:RefundCommand){
  if(!command || !ID.test(command.clientRefundId||'')||!['CASH','ORIGINAL_METHOD'].includes(command.refundMethod)||
    typeof command.reason!=='string'||!command.reason.trim()||command.reason.length>500||
    !Array.isArray(command.items)||!command.items.length||command.items.length>200)
    throw new FinanceError(400,'INVALID_REFUND');
  const occurredAt=timestamp(command.occurredAt||new Date().toISOString());
  const normalized={...command,occurredAt,reason:command.reason.trim(),items:[...command.items].sort((a,b)=>a.clientItemId.localeCompare(b.clientItemId))};
  const txn=(await db.query(`SELECT * FROM pos.transactions WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND outlet_id=$4 FOR UPDATE`,
    [transactionId,scope.tenantId,scope.merchantId,scope.outletId])).rows[0];
  if(!txn)throw new FinanceError(404,'TRANSACTION_NOT_FOUND');
  const previous=(await db.query('SELECT * FROM pos.transaction_refunds WHERE tenant_id=$1 AND client_refund_id=$2',[scope.tenantId,command.clientRefundId])).rows[0];
  if(previous){
    if(previous.transaction_id!==transactionId||JSON.stringify(previous.command)!==JSON.stringify(normalized)){
      // JSONB key order is not significant. Compare structurally inside Postgres.
      const same=(await db.query('SELECT command=$2::jsonb AS same FROM pos.transaction_refunds WHERE id=$1',[previous.id,JSON.stringify(normalized)])).rows[0]?.same;
      if(previous.transaction_id!==transactionId||!same)throw new FinanceError(409,'REFUND_ID_CONFLICT');
    }
    return {id:previous.id,clientRefundId:previous.client_refund_id,amount:Number(previous.amount),subtotal:Number(previous.subtotal_amount),discount:Number(previous.discount_amount),tax:Number(previous.tax_amount),service:Number(previous.service_amount),replayed:true};
  }
  const eligible=(await db.query('SELECT id FROM contract.merchant_revenue WHERE id=$1 AND tenant_id=$2',[transactionId,scope.tenantId])).rows[0];
  if(!eligible)throw new FinanceError(409,'TRANSACTION_NOT_REFUNDABLE');
  const rows=(await db.query(`SELECT i.*,COALESCE(i.quantity_exact,i.quantity) AS quantity,COALESCE(r.quantity,0) AS returned FROM pos.transaction_items i
    LEFT JOIN LATERAL(SELECT SUM(ri.quantity) AS quantity FROM pos.transaction_refund_items ri
      WHERE ri.transaction_item_id=i.id) r ON true WHERE i.transaction_id=$1 AND i.tenant_id=$2`,[transactionId,scope.tenantId])).rows;
  const seen=new Set<string>();let subtotal=0,netItems=0;
  const lines=normalized.items.map(item=>{
    if(!ID.test(item.clientItemId||'')||seen.has(item.clientItemId)||!Number.isFinite(item.quantity)||item.quantity<=0||Math.abs(item.quantity*1000-Math.round(item.quantity*1000))>0.001)
      throw new FinanceError(400,'INVALID_REFUND_ITEM');
    seen.add(item.clientItemId);
    const line=rows.find(row=>row.client_item_id===item.clientItemId||row.id===item.clientItemId);
    if(!line||item.quantity>Number(line.quantity)-Number(line.returned))throw new FinanceError(409,'REFUND_QUANTITY_EXCEEDED');
    const amount=money(Number(line.total_price)*item.quantity/Number(line.quantity));
    subtotal+=money(Number(line.unit_price)*item.quantity);netItems+=amount;
    return {line,quantity:item.quantity,amount};
  });
  subtotal=money(subtotal);
  const allNetItems=rows.reduce((sum,row)=>sum+Number(row.total_price),0);
  const ratio=allNetItems>0?netItems/allNetItems:0;
  const already=(await db.query(`SELECT COALESCE(SUM(amount),0) AS amount,COALESCE(SUM(discount_amount),0) AS discount,
    COALESCE(SUM(tax_amount),0) AS tax,COALESCE(SUM(service_amount),0) AS service
    FROM pos.transaction_refunds WHERE transaction_id=$1`,[transactionId])).rows[0];
  const last=rows.every(row=>Number(row.returned)+(lines.find(l=>l.line.id===row.id)?.quantity||0)>=Number(row.quantity));
  const component=(name:string,total:number)=>last?money(total-Number(already[name])):Math.min(money(total*ratio),money(total-Number(already[name])));
  const lineDiscount=money(subtotal-netItems);
  const discount=last?money(Number(txn.discount_amount)-Number(already.discount)):
    Math.min(lineDiscount,money(Number(txn.discount_amount)-Number(already.discount)));
  const tax=component('tax',Number(txn.tax_amount)),service=component('service',Number(txn.service_charge_amount));
  const amount=last?money(Number(txn.total_amount)-Number(already.amount)):money(subtotal-discount+tax+service);
  if(amount<=0||amount>money(Number(txn.total_amount)-Number(already.amount)))throw new FinanceError(409,'REFUND_AMOUNT_EXCEEDED');
  const refund=(await db.query(`INSERT INTO pos.transaction_refunds
    (tenant_id,merchant_id,outlet_id,transaction_id,client_refund_id,amount,subtotal_amount,discount_amount,tax_amount,service_amount,refund_method,reason,actor_ref,occurred_at,command)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb) RETURNING id`,
    [scope.tenantId,scope.merchantId,scope.outletId,transactionId,command.clientRefundId,amount,subtotal,discount,tax,service,command.refundMethod,normalized.reason,scope.actorRef,occurredAt,JSON.stringify(normalized)])).rows[0];
  for(const {line,quantity,amount:lineAmount} of lines){
    await db.query('INSERT INTO pos.transaction_refund_items(refund_id,transaction_item_id,quantity,amount) VALUES($1,$2,$3,$4)',[refund.id,line.id,quantity,lineAmount]);
    // Stock restoration uses the same original sale location and immutable deltas.
    await db.query(`INSERT INTO pos.inventory_transactions(id,tenant_id,merchant_id,outlet_id,location_id,inventory_item_id,quantity_delta,reference_type,reference_id,reason)
      SELECT uuidv7(),s.tenant_id,s.merchant_id,s.outlet_id,s.location_id,s.inventory_item_id,$2,'REFUND_RESTORE',$3,'Retur POS'
      FROM pos.inventory_transactions s JOIN pos.products p ON p.inventory_item_id=s.inventory_item_id
      WHERE s.reference_id=$1 AND s.reference_type='SALE_DEDUCT' AND p.id=$4 LIMIT 1`,[transactionId,quantity,refund.id,line.product_id]);
  }
  // CASH explicitly uses the drawer. Original-method cash refunds use actual
  // remaining cash paid; mixed electronic refunds never fabricate cash movement.
  const cashPaid=Number((await db.query(`SELECT COALESCE(SUM(amount),0) AS amount FROM pos.cash_ledger
    WHERE transaction_id=$1 AND tenant_id=$2`,[transactionId,scope.tenantId])).rows[0]?.amount||0);
  const tenders=(await db.query(`SELECT COALESCE(SUM(amount) FILTER(WHERE payment_method='CASH'),0) AS cash,
    COALESCE(SUM(amount),0) AS total FROM pos.payments WHERE transaction_id=$1 AND tenant_id=$2
    AND payment_status IN('PAID','SETTLED')`,[transactionId,scope.tenantId])).rows[0];
  const originalCash=Number(tenders.total)>0?money(amount*Number(tenders.cash)/Number(tenders.total)):0;
  const cashRefund=command.refundMethod==='CASH'?amount:Math.min(originalCash,Math.max(0,cashPaid));
  if(cashRefund>0)await db.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,transaction_id,reference_id,note,actor_ref,occurred_at)
    VALUES($1,$2,$3,$4,'REFUND',$5,$6,$7,$8,$9,$10)`,[scope.tenantId,scope.merchantId,scope.outletId,'refund:'+refund.id,-cashRefund,transactionId,refund.id,normalized.reason,scope.actorRef,occurredAt]);
  await writeActivity(db,{tenantId:scope.tenantId,merchantId:scope.merchantId,businessSector:scope.sector,appModule:'POS',eventType:'TRANSACTION_REFUND',transactionId,amountIdr:amount,severity:'WARNING',summary:'Retur transaksi dicatat',detail:{clientRefundId:command.clientRefundId}});
  return {id:refund.id,clientRefundId:command.clientRefundId,amount,subtotal,discount,tax,service,replayed:false};
}

export function registerFinanceRoutes(app:Express,db:Db){
  const route=(path:string,run:(c:Db,s:FinancialScope,req:Request)=>Promise<unknown>)=>app.post(path,async(req,res)=>{
    try{const result=await db.tx(async c=>run(c,await scopeFor(c,req),req));res.json({ok:true,...result as object});}
    catch(error){const known=error instanceof FinanceError||error instanceof BillingError;
      if(!known&&!(error instanceof FreePlanAccessError)){
        const diagnostic=error as {code?:string;constraint?:string;column?:string};
        console.error('[finance] write failed',{route:path,code:diagnostic.code,constraint:diagnostic.constraint,column:diagnostic.column});
      }
      res.status(known?error.status:error instanceof FreePlanAccessError?403:500).json({ok:false,error:known||error instanceof FreePlanAccessError?error.message:'FINANCIAL_WRITE_FAILED'});}
  });
  app.get('/api/v1/finance/shift',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try{const result=await db.tx(async c=>{
      const s=await scopeFor(c,req);
      const rows=(await c.query(`SELECT * FROM pos.shifts WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 ORDER BY opened_at DESC LIMIT 100`,[s.tenantId,s.merchantId,s.outletId])).rows;
      const current=rows.find(r=>r.status==='OPEN');
      return {shift:current?await calculateShift(c,s,current):null,history:rows.filter(r=>r.status==='CLOSED').map(r=>r.summary).filter(Boolean)};
    });res.json({ok:true,...result});}catch(error){
      if(!(error instanceof FinanceError)&&!(error instanceof BillingError)){
        const diagnostic=error as {code?:string;constraint?:string;table?:string;column?:string};
        console.error('[finance] shift read failed',{code:diagnostic.code,constraint:diagnostic.constraint,table:diagnostic.table,column:diagnostic.column});
      }
      res.status(error instanceof FinanceError||error instanceof BillingError?error.status:503).json({ok:false,error:error instanceof FinanceError||error instanceof BillingError?error.message:'SHIFT_UNAVAILABLE'});}
  });
  route('/api/v1/finance/shift/open',async(c,s,req)=>{
    const b=req.body;if(!ID.test(b.clientShiftId||'')||!Number.isFinite(b.initialCash)||b.initialCash<0||b.initialCash>9999999999)throw new FinanceError(400,'INVALID_SHIFT');
    await c.query('SELECT id FROM internal.outlets WHERE id=$1 FOR UPDATE',[s.outletId]);
    const active=(await c.query(`SELECT * FROM pos.shifts WHERE tenant_id=$1 AND outlet_id=$2 AND status='OPEN' ORDER BY opened_at DESC LIMIT 1`,[s.tenantId,s.outletId])).rows[0];
    if(active)return {shift:await calculateShift(c,s,active),replayed:true};
    const previous=(await c.query('SELECT id FROM pos.shifts WHERE tenant_id=$1 AND client_shift_id=$2',[s.tenantId,b.clientShiftId])).rows[0];
    if(previous)throw new FinanceError(409,'SHIFT_ALREADY_CLOSED');
    let register=(await c.query("SELECT id FROM pos.cash_registers WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND status='ACTIVE' ORDER BY created_at LIMIT 1",[s.tenantId,s.merchantId,s.outletId])).rows[0];
    if(!register)register=(await c.query("INSERT INTO pos.cash_registers(tenant_id,merchant_id,outlet_id,name) VALUES($1,$2,$3,'Kas bersama outlet') RETURNING id",[s.tenantId,s.merchantId,s.outletId])).rows[0];
    const row=(await c.query(`INSERT INTO pos.shifts(tenant_id,merchant_id,outlet_id,client_shift_id,actor_name,opening_cash,business_date,status,register_id)
      VALUES($1,$2,$3,$4,$5,$6,(now() AT TIME ZONE 'Asia/Jakarta')::date,'OPEN',$7) RETURNING *`,[s.tenantId,s.merchantId,s.outletId,b.clientShiftId,String(b.cashierName||'Kasir').slice(0,100),money(b.initialCash),register.id])).rows[0];
    await c.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,note,category,shift_ref,actor_ref,actor_name)
      VALUES($1,$2,$3,$4,'OPENING',$5,'Modal awal shift','MODAL_AWAL',$6,$7,$8)`,[s.tenantId,s.merchantId,s.outletId,'opening:'+row.id,money(b.initialCash),b.clientShiftId,s.actorRef,row.actor_name]);
    return {shift:await calculateShift(c,s,row),replayed:false};
  });
  route('/api/v1/finance/shift/close',async(c,s,req)=>{
    const b=req.body;if(!ID.test(b.clientShiftId||'')||!Number.isFinite(b.actualCash)||b.actualCash<0||b.actualCash>9999999999)throw new FinanceError(400,'INVALID_SHIFT');
    const row=(await c.query(`SELECT * FROM pos.shifts WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND client_shift_id=$4 FOR UPDATE`,[s.tenantId,s.merchantId,s.outletId,b.clientShiftId])).rows[0];
    if(!row)throw new FinanceError(409,'SHIFT_NOT_FOUND');
    if(row.status==='CLOSED'){
      if(Number(row.closing_cash)!==money(b.actualCash))throw new FinanceError(409,'SHIFT_CLOSE_CONFLICT');
      return {shift:row.summary,replayed:true};
    }
    const summary={...await calculateShift(c,s,row),status:'CLOSED' as const,endTime:new Date().toISOString(),actualCash:money(b.actualCash),notes:String(b.notes||'').slice(0,500)};
    summary.difference=money(summary.actualCash-summary.expectedCash);
    await c.query(`UPDATE pos.shifts SET status='CLOSED',closed_at=$2,closing_cash=$3,expected_cash=$4,cash_difference=$5,summary=$6::jsonb,notes=$7 WHERE id=$1`,[row.id,summary.endTime,summary.actualCash,summary.expectedCash,summary.difference,JSON.stringify(summary),summary.notes]);
    await writeActivity(c,{tenantId:s.tenantId,merchantId:s.merchantId,businessSector:s.sector,appModule:'POS',eventType:'SHIFT_CLOSED',severity:'INFO',summary:'Shift ditutup',detail:{clientShiftId:b.clientShiftId,expectedCash:summary.expectedCash,difference:summary.difference}});
    return {shift:summary,replayed:false};
  });
  route('/api/v1/finance/refund',async(c,s,req)=>{
    const id=String(req.body?.clientTxnId||'');
    const txn=(await c.query('SELECT id FROM pos.transactions WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND client_txn_id=$4',[s.tenantId,s.merchantId,s.outletId,id])).rows[0];
    if(!txn)throw new FinanceError(409,'TRANSACTION_SYNC_REQUIRED');
    return {refund:await applyRefund(c,s,txn.id,req.body.refund)};
  });
  route('/api/v1/finance/cash',async(c,s,req)=>{
    const b=req.body;if(!ID.test(b.clientEventId||'')||!['CASH_IN','CASH_OUT','OPENING'].includes(b.type)||
      typeof b.amount!=='number'||!Number.isFinite(b.amount)||b.amount<0||b.amount>9999999999||
      typeof b.description!=='string'||b.description.length>500||typeof b.category!=='string'||b.category.length>64)
      throw new FinanceError(400,'INVALID_CASH_EVENT');
    const amount=money(b.amount)*(b.type==='CASH_OUT'?-1:1),occurredAt=timestamp(b.occurredAt);
    const command={clientEventId:b.clientEventId,type:b.type,amount,occurredAt,category:b.category,description:b.description.trim(),shiftId:String(b.shiftId||''),recipientOrSource:String(b.recipientOrSource||'').slice(0,200)};
    const prev=(await c.query('SELECT id,command=$2::jsonb AS same,outlet_id FROM pos.cash_ledger WHERE tenant_id=$1 AND client_event_id=$3',[s.tenantId,JSON.stringify(command),b.clientEventId])).rows[0];
    if(prev){if(!prev.same||prev.outlet_id!==s.outletId)throw new FinanceError(409,'CASH_EVENT_ID_CONFLICT');return{id:prev.id,replayed:true};}
    const row=(await c.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,note,category,actor_ref,actor_name,shift_ref,recipient_or_source,occurred_at,command)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) RETURNING id`,[s.tenantId,s.merchantId,s.outletId,b.clientEventId,b.type,amount,command.description,b.category,s.actorRef,String(b.actorName||'').slice(0,100),command.shiftId,command.recipientOrSource,occurredAt,JSON.stringify(command)])).rows[0];
    await writeActivity(c,{tenantId:s.tenantId,merchantId:s.merchantId,businessSector:s.sector,appModule:'POS',eventType:b.type,severity:'INFO',amountIdr:amount,summary:command.description||'Mutasi kas',detail:{clientEventId:b.clientEventId}});
    return {id:row.id,replayed:false};
  });
  route('/api/v1/finance/cash/reverse',async(c,s,req)=>{
    const b=req.body;if(!ID.test(b.clientEventId||'')||!ID.test(b.originalEventId||'')||typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>500)throw new FinanceError(400,'INVALID_CASH_REVERSAL');
    const original=(await c.query(`SELECT * FROM pos.cash_ledger WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND client_event_id=$4 FOR UPDATE`,[s.tenantId,s.merchantId,s.outletId,b.originalEventId])).rows[0];
    if(!original||!['CASH_IN','CASH_OUT','OPENING'].includes(original.event_type))throw new FinanceError(409,'CASH_EVENT_NOT_REVERSIBLE');
    const reused=(await c.query('SELECT reference_id,event_type FROM pos.cash_ledger WHERE tenant_id=$1 AND client_event_id=$2',[s.tenantId,b.clientEventId])).rows[0];
    if(reused&&(reused.event_type!=='REVERSAL'||reused.reference_id!==original.id))throw new FinanceError(409,'CASH_EVENT_ID_CONFLICT');
    const existing=(await c.query(`SELECT id FROM pos.cash_ledger WHERE tenant_id=$1 AND event_type='REVERSAL' AND reference_id=$2`,[s.tenantId,original.id])).rows[0];
    if(existing)return {id:existing.id,replayed:true};
    const row=(await c.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,reference_id,note,category,actor_ref)
      VALUES($1,$2,$3,$4,'REVERSAL',$5,$6,$7,$8,$9) RETURNING id`,[s.tenantId,s.merchantId,s.outletId,b.clientEventId,-Number(original.amount),original.id,b.reason.trim(),original.category,s.actorRef])).rows[0];
    await writeActivity(c,{tenantId:s.tenantId,merchantId:s.merchantId,businessSector:s.sector,appModule:'POS',eventType:'CASH_REVERSAL',severity:'WARNING',amountIdr:-Number(original.amount),summary:b.reason,detail:{originalEventId:b.originalEventId}});
    return {id:row.id,replayed:false};
  });
}

async function calculateShift(db:Db,scope:FinancialScope,row:any):Promise<Shift>{
  const params=[scope.tenantId,scope.merchantId,scope.outletId,row.opened_at,row.closed_at||new Date().toISOString()];
  const revenue=(await db.query(`WITH revenue AS (
    SELECT * FROM contract.merchant_revenue WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3
    AND created_at >=$4 AND ($5::timestamptz IS NULL OR created_at<$5)
  ), tenders AS (
    SELECT r.id,r.total_amount,p.payment_method,p.amount,SUM(p.amount) OVER(PARTITION BY r.id) AS paid
    FROM revenue r JOIN pos.payments p ON p.transaction_id=r.id AND p.tenant_id=r.tenant_id
    AND p.payment_status IN('PAID','SETTLED')
  ) SELECT (SELECT COUNT(*)::int FROM revenue) AS orders,(SELECT COALESCE(SUM(total_amount),0) FROM revenue) AS total,
    COALESCE(SUM(total_amount*amount/NULLIF(paid,0)) FILTER(WHERE payment_method='CASH'),0) AS cash,
    COALESCE(SUM(total_amount*amount/NULLIF(paid,0)) FILTER(WHERE payment_method IN('QRIS','QRIS_DYNAMIC','QRIS_STATIC')),0) AS qris,
    COALESCE(SUM(total_amount*amount/NULLIF(paid,0)) FILTER(WHERE payment_method IN('DEBIT','CREDIT','DEBIT_CARD','CREDIT_CARD','CARD')),0) AS card FROM tenders`,params)).rows[0];
  const cash=(await db.query(`SELECT COALESCE(SUM(c.amount),0) AS balance,
    COALESCE(SUM(c.amount) FILTER(WHERE COALESCE(original.event_type,c.event_type)='OPENING' OR c.category='MODAL_AWAL'),0) AS opening,
    COALESCE(SUM(c.amount) FILTER(WHERE COALESCE(original.event_type,c.event_type)='CASH_IN' AND c.category<>'MODAL_AWAL'),0) AS cash_in,
    COALESCE(-SUM(c.amount) FILTER(WHERE COALESCE(original.event_type,c.event_type)='CASH_OUT'),0) AS cash_out
    FROM pos.cash_ledger c LEFT JOIN pos.cash_ledger original ON c.event_type='REVERSAL'
      AND c.reference_id=original.id::text AND c.tenant_id=original.tenant_id
    WHERE c.tenant_id=$1 AND c.merchant_id=$2 AND c.outlet_id=$3 AND c.occurred_at >=$4 AND ($5::timestamptz IS NULL OR c.occurred_at<$5)`,params)).rows[0];
  return{id:row.client_shift_id||row.id,cashierName:row.actor_name||'Kasir',startTime:new Date(row.opened_at).toISOString(),
    initialCash:Number(cash.opening),cashSales:money(Number(revenue.cash)),qrisSales:money(Number(revenue.qris)),cardSales:money(Number(revenue.card)),
    eWalletSales:money(Number(revenue.total)-Number(revenue.cash)-Number(revenue.qris)-Number(revenue.card)),totalSales:Number(revenue.total),
    totalCashIn:Number(cash.cash_in),totalCashOut:Number(cash.cash_out),expectedCash:Number(cash.balance),totalOrders:Number(revenue.orders),status:row.status};
}
