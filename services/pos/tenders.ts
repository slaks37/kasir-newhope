import type {Db} from '../shared/db';
import {FinanceError,type FinancialScope} from './finance';

export interface TenderCommand {clientPaymentId:string;method:string;amount:number;createdAt:string}
export async function applyTenders(db:Db,scope:FinancialScope,transactionId:string,tenders:TenderCommand[]){
  if(!Array.isArray(tenders)||!tenders.length||tenders.length>100)throw new FinanceError(400,'INVALID_TENDERS');
  const txn=(await db.query('SELECT * FROM pos.transactions WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND outlet_id=$4 FOR UPDATE',[transactionId,scope.tenantId,scope.merchantId,scope.outletId])).rows[0];
  if(!txn||['VOIDED','CANCELLED','REFUNDED'].includes(txn.order_status))throw new FinanceError(409,'TRANSACTION_NOT_PAYABLE');
  const seen=new Set<string>();
  for(const tender of tenders){
    if(typeof tender.clientPaymentId!=='string'||!/^[-a-zA-Z0-9_:]{1,128}$/.test(tender.clientPaymentId)||seen.has(tender.clientPaymentId)||
      !['CASH','QRIS','DEBIT','CREDIT','TRANSFER','E_WALLET','SHOPEEPAY','GOPAY','OVO','DANA','QRIS_STATIC','QRIS_DYNAMIC'].includes(tender.method)||
      !Number.isFinite(tender.amount)||tender.amount<=0||Math.abs(tender.amount*100-Math.round(tender.amount*100))>0.001||!Number.isFinite(Date.parse(tender.createdAt)))throw new FinanceError(400,'INVALID_TENDER');
    seen.add(tender.clientPaymentId);
    const previous=(await db.query('SELECT * FROM pos.payments WHERE transaction_id=$1 AND client_payment_id=$2',[transactionId,tender.clientPaymentId])).rows[0];
    if(previous){if(Number(previous.amount)!==tender.amount||previous.payment_method!==tender.method||new Date(previous.created_at).toISOString()!==new Date(tender.createdAt).toISOString())throw new FinanceError(409,'TENDER_ID_CONFLICT');continue;}
    const paid=Number((await db.query("SELECT COALESCE(SUM(amount),0) AS amount FROM pos.payments WHERE transaction_id=$1 AND payment_status IN('PAID','SETTLED')",[transactionId])).rows[0].amount);
    if(Math.round((paid+tender.amount)*100)>Math.round(Number(txn.total_amount)*100))throw new FinanceError(409,'TENDER_EXCEEDS_BALANCE');
    const row=(await db.query(`INSERT INTO pos.payments(tenant_id,merchant_id,outlet_id,transaction_id,client_payment_id,payment_method,payment_status,amount,gateway_provider,paid_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,'PAID',$7,'MANUAL_CASH',$8,$8) RETURNING id`,[scope.tenantId,scope.merchantId,scope.outletId,transactionId,tender.clientPaymentId,tender.method,tender.amount,tender.createdAt])).rows[0];
    if(tender.method==='CASH')await db.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,transaction_id,actor_ref,note,occurred_at)
      VALUES($1,$2,$3,$4,'SALE',$5,$6,$7,'Pembayaran tunai split',$8)`,[scope.tenantId,scope.merchantId,scope.outletId,'payment:'+row.id,tender.amount,transactionId,scope.actorRef,tender.createdAt]);
  }
}
