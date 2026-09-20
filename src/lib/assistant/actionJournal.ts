import type { BrainAction } from './businessBrain';
import type { MerchantSnapshot } from './types';
import { DAY, businessTime } from './periods';
import { isFreePlan } from '../../config/freePlanPolicy';

export interface ActionRecord { id:string; businessId:string; action:BrainAction; status:'DRAFT'|'APPROVED'|'DONE'|'MEASURED'; createdAt:string; approvedAt?:string; doneAt?:string; note?:string; measurement?:{before:number;after:number;label:string;from:string;to:string} }
/** Stored drafts are untrusted device data, not an execution capability. */
export function parseActionJournal(raw:string,businessId:string):ActionRecord[] {
  try {
    const data:unknown=JSON.parse(raw);
    if(!Array.isArray(data))return [];
    return data.filter((r:any)=>r&&typeof r.id==='string'&&r.businessId===businessId&&
      ['DRAFT','APPROVED','DONE','MEASURED'].includes(r.status)&&typeof r.createdAt==='string'&&
      r.action&&typeof r.action.id==='string'&&typeof r.action.title==='string'&&typeof r.action.draft==='string'&&
      typeof r.action.reason==='string'&&['PROCUREMENT','CRM','PRICING','WORKFORCE','REVIEW','PROMO'].includes(r.action.kind)&&
      ['revenue','orders','stockCritical'].includes(r.action.metric)&&
      (!r.measurement || (Number.isFinite(r.measurement.before)&&Number.isFinite(r.measurement.after)&&typeof r.measurement.label==='string'))
    ).slice(-100);
  } catch {return [];}
}
export function advanceAction(record:ActionRecord,status:ActionRecord['status'],s:MerchantSnapshot,now=new Date(),note=''):ActionRecord {
  if(isFreePlan(s.settings.subscription)||record.businessId!==s.businessId||s.userRole!=='ADMIN')throw new Error('OWNER_APPROVAL_REQUIRED');
  const allowed={DRAFT:'APPROVED',APPROVED:'DONE',DONE:'MEASURED',MEASURED:null};
  if(allowed[record.status]!==status)throw new Error('INVALID_ACTION_TRANSITION');
  if(status==='DONE'&&!note.trim())throw new Error('Catat tindakan yang benar-benar sudah dilakukan.');
  if(status==='MEASURED') {
    const start=businessTime(record.doneAt); const end=start+7*DAY;
    if(!Number.isFinite(start)||now.getTime()<end)throw new Error('Pengukuran tersedia setelah tujuh hari sejak tindakan dicatat selesai.');
    const sales=s.orders.filter(o=>o.status==='COMPLETED'&&o.paymentStatus==='PAID');
    const value=(from:number,to:number)=>sales.filter(o=>businessTime(o.date)>=from&&businessTime(o.date)<to).reduce((n,o)=>n+(record.action.metric==='orders'?1:o.total),0);
    // Inventory has no historical balance series; don't substitute revenue.
    if(record.action.metric==='stockCritical')throw new Error('Pengukuran dampak stok memerlukan histori saldo stok; belum tersedia.');
    return {...record,status,measurement:{before:value(start-7*DAY,start),after:value(start,end),label:record.action.metric==='orders'?'Transaksi':'Omzet',from:new Date(start).toISOString(),to:new Date(end).toISOString()}};
  }
  return {...record,status,...(status==='APPROVED'?{approvedAt:now.toISOString()}:{doneAt:now.toISOString(),note:note.trim()})};
}
