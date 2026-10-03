import type {Db} from '../shared/db';
import {BillingError} from '../billing/engine';

type Scope={tenantId:string;merchantId:string};
type Operation={kind:string;recordId:string;value:unknown;deleted:boolean};
const text=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';
const timestamp=(value:unknown,optional=false)=>{
  if(optional&&(value===undefined||value===null||value===''))return null;
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new BillingError(422,'INVALID_LABOR_DATE');
  return new Date(value).toISOString();
};
const money=(value:unknown)=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new BillingError(422,'INVALID_PAYROLL_AMOUNT');
  return value;
};

/** Runs only after the shared-state revision is accepted, in its per-record
 * savepoint. These are admin projections, never a source for financial totals.
 * Existing normalized IDs/paid payroll history are retained, not rekeyed. */
export async function projectLabor(c:Db,scope:Scope,sector:string,op:Operation){
  if(op.kind!=='attendance_logs'&&op.kind!=='payroll_slips')return;
  const attendance=op.kind==='attendance_logs';
  const table=attendance?'pos.staff_attendances':'pos.staff_payrolls';
  const clientColumn=attendance?'client_attendance_id':'client_slip_id';
  const existing=(await c.query(`SELECT * FROM ${table} WHERE tenant_id=$1 AND ${clientColumn}=$2 FOR UPDATE`,[scope.tenantId,op.recordId])).rows[0];
  if(existing&&existing.merchant_id!==scope.merchantId)throw new BillingError(409,'LABOR_PROJECTION_OWNER_CONFLICT');
  if(op.deleted){
    // Retain normalized historical records; the versioned tombstone describes
    // operational removal. Paid financial metadata cannot disappear silently.
    if(!attendance&&existing?.status==='PAID')throw new BillingError(409,'PAID_PAYROLL_IMMUTABLE');
    return;
  }
  const value=op.value as Record<string,unknown>;
  if(value.id!==op.recordId||!text(value.staffId,96)||!text(value.staffName,120))throw new BillingError(422,'INVALID_LABOR_RECORD');
  if(attendance){
    if(!['CLOCKED_IN','CLOCKED_OUT'].includes(String(value.status)))throw new BillingError(422,'INVALID_ATTENDANCE_STATUS');
    const started=timestamp(value.clockInTime),ended=timestamp(value.clockOutTime,true);
    if(value.status==='CLOCKED_OUT'&&!ended||ended&&Date.parse(ended)<Date.parse(started!))throw new BillingError(422,'INVALID_ATTENDANCE_DATE');
    if(typeof value.branchId!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.branchId))throw new BillingError(422,'ATTENDANCE_OUTLET_REQUIRED');
    const outlet=(await c.query('SELECT id FROM internal.outlets WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3',[value.branchId,scope.tenantId,scope.merchantId])).rows[0];
    if(!outlet)throw new BillingError(403,'ATTENDANCE_OUTLET_NOT_OWNED');
    if(existing&&(existing.staff_id!==value.staffId||existing.outlet_id!==outlet.id||new Date(existing.clock_in_at).toISOString()!==started))throw new BillingError(409,'ATTENDANCE_IDENTITY_IMMUTABLE');
    if(existing?.clock_out_at&&(!ended||new Date(existing.clock_out_at).toISOString()!==ended))throw new BillingError(409,'CLOSED_ATTENDANCE_IMMUTABLE');
    if(existing&&existing.status===value.status&&(existing.clock_out_at?new Date(existing.clock_out_at).toISOString():null)===ended&&
      existing.shift_notes===(text(value.shiftNotes,500)||null)&&JSON.stringify(existing.clock_out_geo)===JSON.stringify(value.clockOutGeo||null))return;
    const saved=await c.query(`INSERT INTO pos.staff_attendances
      (tenant_id,merchant_id,outlet_id,client_attendance_id,staff_id,staff_name,staff_role,clock_in_at,clock_out_at,
       shift_notes,status,branch_id,branch_name,clock_in_geo,clock_out_geo,business_sector)
      VALUES($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$3::text,$12,$13::jsonb,$14::jsonb,$15)
      ON CONFLICT(tenant_id,client_attendance_id) DO UPDATE SET
        clock_out_at=EXCLUDED.clock_out_at,shift_notes=EXCLUDED.shift_notes,status=EXCLUDED.status,
        clock_out_geo=EXCLUDED.clock_out_geo,updated_at=now()
      WHERE pos.staff_attendances.merchant_id=EXCLUDED.merchant_id RETURNING id`,
      [scope.tenantId,scope.merchantId,outlet.id,op.recordId,value.staffId,text(value.staffName,120),text(value.staffRole,64)||'STAFF',
        started,ended,text(value.shiftNotes,500)||null,value.status,text(value.branchName,100),JSON.stringify(value.clockInGeo||null),JSON.stringify(value.clockOutGeo||null),sector]);
    if(!saved.rows.length)throw new BillingError(409,'LABOR_PROJECTION_OWNER_CONFLICT');
    return;
  }
  if(!['DRAFT','PAID'].includes(String(value.status))||typeof value.periodMonth!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.periodMonth)||
    !Number.isSafeInteger(value.daysAttended)||Number(value.daysAttended)<0)throw new BillingError(422,'INVALID_PAYROLL_RECORD');
  const start=timestamp(value.periodStart),end=timestamp(value.periodEnd),paid=timestamp(value.paidAt,true);
  if(end!<start!||value.status==='PAID'&&!paid)throw new BillingError(422,'INVALID_PAYROLL_DATE');
  const fields=['baseSalary','allowance','individualCommission','teamPoolCommission','dailyTargetBonus','grossEarnings','deductions','netSalary'];
  const amounts=fields.map(field=>money(value[field]));
  const columns=['base_salary','allowance','individual_commission','team_pool_commission','daily_target_bonus','gross_earnings','deductions','net_salary'];
  if(existing?.status==='PAID'){
    if(value.status!=='PAID'||existing.staff_id!==value.staffId||existing.period_month!==value.periodMonth||
      new Date(existing.period_start).toISOString().slice(0,10)!==start!.slice(0,10)||new Date(existing.period_end).toISOString().slice(0,10)!==end!.slice(0,10)||
      new Date(existing.paid_at).toISOString()!==paid||existing.payment_method!==(text(value.paymentMethod,64)||null)||
      Number(existing.days_attended)!==Number(value.daysAttended)||columns.some((column,index)=>Number(existing[column])!==amounts[index]))
      throw new BillingError(409,'PAID_PAYROLL_IMMUTABLE');
    return;
  }
  const saved=await c.query(`INSERT INTO pos.staff_payrolls
    (tenant_id,merchant_id,client_slip_id,staff_id,staff_name,staff_role,period_month,period_start,period_end,days_attended,
     base_salary,allowance,individual_commission,team_pool_commission,daily_target_bonus,gross_earnings,deductions,net_salary,
     status,paid_at,payment_method,notes,business_sector)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
    ON CONFLICT(tenant_id,client_slip_id) DO UPDATE SET
      staff_id=EXCLUDED.staff_id,staff_name=EXCLUDED.staff_name,staff_role=EXCLUDED.staff_role,
      period_month=EXCLUDED.period_month,period_start=EXCLUDED.period_start,period_end=EXCLUDED.period_end,days_attended=EXCLUDED.days_attended,
      base_salary=EXCLUDED.base_salary,allowance=EXCLUDED.allowance,individual_commission=EXCLUDED.individual_commission,
      team_pool_commission=EXCLUDED.team_pool_commission,daily_target_bonus=EXCLUDED.daily_target_bonus,
      gross_earnings=EXCLUDED.gross_earnings,deductions=EXCLUDED.deductions,net_salary=EXCLUDED.net_salary,
      status=EXCLUDED.status,paid_at=EXCLUDED.paid_at,payment_method=EXCLUDED.payment_method,notes=EXCLUDED.notes,updated_at=now()
    WHERE pos.staff_payrolls.merchant_id=EXCLUDED.merchant_id AND pos.staff_payrolls.status<>'PAID' RETURNING id`,
    [scope.tenantId,scope.merchantId,op.recordId,value.staffId,text(value.staffName,120),text(value.staffRole,64)||'STAFF',value.periodMonth,
      start!.slice(0,10),end!.slice(0,10),value.daysAttended,...amounts,value.status,paid,text(value.paymentMethod,64)||null,text(value.notes,500)||null,sector]);
  if(!saved.rows.length)throw new BillingError(409,'LABOR_PROJECTION_OWNER_CONFLICT');
}
