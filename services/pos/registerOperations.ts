import {createHash,randomUUID} from 'node:crypto';
import type {Express,Request} from 'express';
import type {Db} from '../shared/db';
import {trustedPrincipal} from '../shared/auth';
import {hasSchemaFeature} from '../shared/schemaFeatures';
import {BillingError} from '../billing/engine';
import {ModuleAccessError} from './modules';
import {resolveWorkspaceScope,type WorkspaceScope} from './workspaceScope';
import {writeActivity,type Sector} from './activity';
import {moduleManifest} from '../../src/platform/modules/registry';
import {registerCapabilities,type RegisterCapability} from '../../src/platform/modules/registerCapabilities';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const ID=/^[^\x00-\x1f\x7f]{1,128}$/;
const round=(v:unknown)=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const iso=(v:unknown)=>new Date(String(v)).toISOString();
export class RegisterError extends Error{constructor(readonly status:number,code:string){super(code);}}
export function requireRegisterCapability(scope:Pick<WorkspaceScope,'role'>,cap:RegisterCapability){if(!registerCapabilities(scope.role).includes(cap))throw new RegisterError(403,'REGISTER_CAPABILITY_FORBIDDEN');}
async function resolve(db:Db,req:Request,cap:RegisterCapability){
 const principal=trustedPrincipal(req);if(!principal||principal.subject==='local-development')throw new RegisterError(401,'UNAUTHENTICATED');
 if(!await hasSchemaFeature(db,'cashierRegisters'))throw new RegisterError(503,'REGISTER_MIGRATION_REQUIRED');
 const scope=await resolveWorkspaceScope(db,principal.subject,req.method==='GET'?req.query:req.body,['pos']);requireRegisterCapability(scope,cap);return scope;
}
async function moduleContext(db:Db,scope:WorkspaceScope,moduleId:string){await db.query("SELECT set_config('app.module_id',$1,true)",[moduleId]);}
async function authorizedModules(db:Db,scope:WorkspaceScope,moduleIds:unknown){
 if(!Array.isArray(moduleIds)||!moduleIds.length||moduleIds.length>5||new Set(moduleIds).size!==moduleIds.length)throw new RegisterError(400,'EXPLICIT_REGISTER_MODULES_REQUIRED');
 for(const moduleId of [...moduleIds].sort())await resolveWorkspaceScope(db,scope.actorRef,{businessId:scope.merchantId,outletId:scope.outletId,moduleId},['pos']);
 await moduleContext(db,scope,scope.moduleId);return [...moduleIds].sort() as string[];
}
export async function clearRegisterBinding(db:Db){await db.query("SELECT set_config('app.register_id','',true),set_config('app.register_shift_id','',true)");}
async function setBinding(db:Db,registerId:string,shiftId:string){await db.query("SELECT set_config('app.register_id',$1,true),set_config('app.register_shift_id',$2,true)",[registerId,shiftId]);}
export async function bindRegisterSale(db:Db,scope:WorkspaceScope,clientShiftId:string){
 await clearRegisterBinding(db);
 const row=(await db.query('SELECT * FROM pos.shifts WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND (client_shift_id=$4 OR id::text=$4)',[scope.tenantId,scope.merchantId,scope.outletId,clientShiftId])).rows[0];
 if(row&&!row.workspace_modules&&row.module_id===scope.moduleId)return null;
 if(!row||!row.workspace_modules?.includes(scope.moduleId))throw new RegisterError(403,'SHIFT_WORKSPACE_MISMATCH');
 await authorizedModules(db,scope,row.workspace_modules);
 await db.query('SELECT id FROM pos.cash_registers WHERE id=$1 FOR UPDATE',[row.register_id]);
 const locked=(await db.query('SELECT * FROM pos.shifts WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
 if(locked.status!=='OPEN')throw new RegisterError(409,'SHIFT_CLOSED_REQUIRES_REVIEW');
 if(scope.role==='CASHIER'&&locked.opened_by_user_id!==scope.actorRef)throw new RegisterError(403,'SHIFT_OPERATOR_REQUIRED');
 await setBinding(db,row.register_id,row.id);return row;
}
export async function bindRegisterCash(db:Db,scope:WorkspaceScope,registerId:unknown){
 if(!UUID.test(String(registerId)))throw new RegisterError(400,'INVALID_REGISTER');
 const r=(await db.query('SELECT * FROM pos.cash_registers WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND outlet_id=$4',[registerId,scope.tenantId,scope.merchantId,scope.outletId])).rows[0];
 if(!r?.workspace_modules?.includes(scope.moduleId))throw new RegisterError(403,'REGISTER_SCOPE_FORBIDDEN');
 await authorizedModules(db,scope,r.workspace_modules);await db.query('SELECT id FROM pos.cash_registers WHERE id=$1 FOR UPDATE',[r.id]);
 const shift=(await db.query("SELECT id FROM pos.shifts WHERE register_id=$1 AND status='OPEN' FOR UPDATE",[r.id])).rows[0];if(!shift)throw new RegisterError(409,'OPEN_REGISTER_SHIFT_REQUIRED');await setBinding(db,r.id,shift.id);
}
async function registers(db:Db,scope:WorkspaceScope){
 const rows=(await db.query("SELECT id,name,module_id,workspace_modules,status FROM pos.cash_registers WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND workspace_modules @> ARRAY[$4]::text[] AND status='ACTIVE' ORDER BY name,id",[scope.tenantId,scope.merchantId,scope.outletId,scope.moduleId])).rows;
 const result:any[]=[];for(const row of rows){try{await authorizedModules(db,scope,row.workspace_modules);result.push(row);}catch(e){if(!(e instanceof ModuleAccessError))throw e;}}
 await moduleContext(db,scope,scope.moduleId);return result;
}
export async function openRegisterShift(db:Db,scope:WorkspaceScope,b:any){
 requireRegisterCapability(scope,'shift.open');
 if(!ID.test(b.clientShiftId||'')||!Number.isFinite(b.initialCash)||b.initialCash<0||b.initialCash>9999999999||Math.abs(b.initialCash*100-Math.round(b.initialCash*100))>0.001)throw new RegisterError(400,'INVALID_SHIFT');
 await clearRegisterBinding(db);await db.query('SELECT id FROM internal.outlets WHERE id=$1 FOR UPDATE',[scope.outletId]);
 let choices=await registers(db,scope),register=choices.find(r=>r.id===b.registerId);
 if(b.registerId&&!register)throw new RegisterError(403,'REGISTER_SCOPE_FORBIDDEN');
 if(!register){if(choices.length>1)throw new RegisterError(409,'EXPLICIT_REGISTER_REQUIRED');register=choices[0];}
 if(!register){const mapped=(await db.query('SELECT id FROM pos.cash_registers WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND workspace_modules @> ARRAY[$4]::text[]',[scope.tenantId,scope.merchantId,scope.outletId,scope.moduleId])).rows.length;throw new RegisterError(mapped?403:409,mapped?'REGISTER_SCOPE_FORBIDDEN':'REGISTER_CONFIGURATION_REQUIRED');}
 await authorizedModules(db,scope,register.workspace_modules);
 await db.query('SELECT id FROM pos.cash_registers WHERE id=$1 FOR UPDATE',[register.id]);
 const active=(await db.query("SELECT * FROM pos.shifts WHERE register_id=$1 AND status='OPEN' FOR UPDATE",[register.id])).rows[0];
 if(active){if(scope.role==='CASHIER'&&active.opened_by_user_id!==scope.actorRef)throw new RegisterError(409,'REGISTER_IN_USE');if(active.client_shift_id!==b.clientShiftId&&Number(b.initialCash)!==0)throw new RegisterError(409,'REGISTER_ALREADY_OPEN');return {shift:await registerSnapshot(db,scope,active),replayed:true};}
 if((await db.query('SELECT id FROM pos.shifts WHERE tenant_id=$1 AND client_shift_id=$2',[scope.tenantId,b.clientShiftId])).rows.length)throw new RegisterError(409,'SHIFT_ALREADY_CLOSED');
 const user=(await db.query('SELECT full_name FROM internal.users WHERE id::text=$1 AND is_active',[scope.actorRef])).rows[0];
 const row=(await db.query(`INSERT INTO pos.shifts(tenant_id,merchant_id,outlet_id,register_id,client_shift_id,actor_name,opened_by_user_id,opening_cash,business_date,workspace_modules) VALUES($1,$2,$3,$4,$5,$6,$7,$8,(now() AT TIME ZONE 'Asia/Jakarta')::date,$9) RETURNING *`,[scope.tenantId,scope.merchantId,scope.outletId,register.id,b.clientShiftId,user.full_name,scope.actorRef,round(b.initialCash),register.workspace_modules])).rows[0];
 await setBinding(db,register.id,row.id);
 await db.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,note,category,shift_ref,actor_ref,actor_name) VALUES($1,$2,$3,$4,'OPENING',$5,'Modal awal shift','MODAL_AWAL',$6,$7,$8)`,[scope.tenantId,scope.merchantId,scope.outletId,'opening:'+row.id,round(b.initialCash),b.clientShiftId,scope.actorRef,user.full_name]);
 await audit(db,scope,'SHIFT_OPENED',{shiftId:row.id,registerId:register.id,moduleIds:row.workspace_modules,initialCash:round(b.initialCash)});
 return {shift:await registerSnapshot(db,scope,row),replayed:false};
}
async function audit(db:Db,s:WorkspaceScope,eventType:string,detail:any){await moduleContext(db,s,s.moduleId);await writeActivity(db,{tenantId:s.tenantId,merchantId:s.merchantId,businessSector:s.sector as Sector,appModule:'POS',eventType,severity:'INFO',summary:eventType,detail});}
/** Whitelisted amounts only: never select/project a cost, margin, or raw ledger payload. */
async function financialTotals(db:Db,s:WorkspaceScope,moduleId:string,shiftId:string|null,day:string|null){
 await moduleContext(db,s,moduleId);
 const p=[s.tenantId,s.merchantId,s.outletId,moduleId,shiftId,day];
 const where=`t.tenant_id=$1 AND t.merchant_id=$2 AND t.outlet_id=$3 AND t.module_id=$4 AND ($5::uuid IS NULL OR t.register_shift_id=$5) AND ($6::date IS NULL OR t.created_at>=($6::date::timestamp AT TIME ZONE 'Asia/Jakarta') AND t.created_at<(($6::date+1)::timestamp AT TIME ZONE 'Asia/Jakarta'))`;
 const revenue=(await db.query(`SELECT count(r.id)::int orders,COALESCE(sum(t.subtotal),0) gross_sales,COALESCE(sum(t.total_amount),0) gross_receivable,COALESCE(sum(r.total_amount),0) net_revenue,COALESCE(sum(r.refund_amount),0) refunds FROM pos.transactions t JOIN contract.merchant_revenue r ON r.id=t.id AND r.tenant_id=t.tenant_id WHERE ${where}`,p)).rows[0];
 const payments=(await db.query(`SELECT p.payment_method,count(*)::int count,sum(p.amount) amount,COALESCE(sum(p.amount) FILTER(WHERE p.verification_origin='PROVIDER_VERIFIED'),0) provider_verified,COALESCE(sum(p.amount) FILTER(WHERE p.verification_origin<>'PROVIDER_VERIFIED'),0) unverified FROM pos.payments p JOIN pos.transactions t ON t.id=p.transaction_id AND t.tenant_id=p.tenant_id WHERE ${where} AND p.payment_status IN('PAID','SETTLED') GROUP BY p.payment_method ORDER BY p.payment_method`,p)).rows;
 const pending=(await db.query(`SELECT count(*)::int count,COALESCE(sum(t.total_amount),0) amount FROM pos.transactions t WHERE ${where} AND NOT EXISTS(SELECT 1 FROM contract.merchant_revenue r WHERE r.id=t.id) AND t.order_status NOT IN('VOIDED','CANCELLED')`,p)).rows[0];
 return {moduleId,grossSales:round(revenue.gross_sales),grossReceivable:round(revenue.gross_receivable),netRevenue:round(revenue.net_revenue),refunds:round(revenue.refunds),orderCount:revenue.orders,payments:payments.map(p=>({method:p.payment_method,count:p.count,receipts:round(p.amount),providerVerified:round(p.provider_verified),unverified:round(p.unverified)})),pendingOrders:pending.count,pendingAmount:round(pending.amount)};
}
export async function registerSnapshot(db:Db,s:WorkspaceScope,row:any):Promise<any>{
 if(row.status==='CLOSED')return row.summary;
 await authorizedModules(db,s,row.workspace_modules);
 const modules:any[]=[],cashRows:any[]=[];
 for(const moduleId of row.workspace_modules){modules.push(await financialTotals(db,s,moduleId,row.id,null));
  cashRows.push((await db.query(`SELECT count(*)::int count,COALESCE(sum(c.amount),0) balance,
   COALESCE(sum(c.amount) FILTER(WHERE COALESCE(original.event_type,c.event_type)='OPENING'),0) opening,
   COALESCE(sum(c.amount) FILTER(WHERE c.event_type='SALE'),0) sales,
   COALESCE(-sum(c.amount) FILTER(WHERE c.event_type='REFUND'),0) refunds,
   COALESCE(-sum(c.amount) FILTER(WHERE c.event_type='VOID'),0) voids,
   COALESCE(sum(c.amount) FILTER(WHERE COALESCE(original.event_type,c.event_type)='CASH_IN'),0) cash_in,
   COALESCE(-sum(c.amount) FILTER(WHERE COALESCE(original.event_type,c.event_type)='CASH_OUT'),0) cash_out,
   md5(COALESCE(string_agg(c.id::text,',' ORDER BY c.id),'')) fingerprint
   FROM pos.cash_ledger c LEFT JOIN pos.cash_ledger original ON c.event_type='REVERSAL' AND original.id::text=c.reference_id AND original.tenant_id=c.tenant_id
   WHERE c.tenant_id=$1 AND c.merchant_id=$2 AND c.outlet_id=$3 AND c.module_id=$4 AND c.register_shift_id=$5`,[s.tenantId,s.merchantId,s.outletId,moduleId,row.id])).rows[0]);
 }
 await moduleContext(db,s,s.moduleId);
 const sum=(field:string)=>{const cents=cashRows.reduce((n,r)=>n+Math.round(Number(r[field]||0)*100),0);if(!Number.isSafeInteger(cents))throw new RegisterError(503,'DRAWER_AMOUNT_TOO_LARGE');return cents/100;};
 const methods=modules.flatMap(m=>m.payments);const method=(allowed:string[])=>round(methods.filter(p=>allowed.includes(p.method)).reduce((n,p)=>n+p.receipts,0));
 const summary={id:row.client_shift_id,serverShiftId:row.id,registerId:row.register_id,moduleIds:row.workspace_modules,openedBy:row.opened_by_user_id,cashierName:row.actor_name,startTime:iso(row.opened_at),businessDate:(typeof row.business_date==='string'?row.business_date.slice(0,10):iso(row.business_date).slice(0,10)),timezone:'Asia/Jakarta',status:row.status,
  initialCash:sum('opening'),cashSales:sum('sales'),cashRefunds:sum('refunds'),cashVoids:sum('voids'),qrisSales:method(['QRIS','QRIS_STATIC','QRIS_DYNAMIC']),cardSales:method(['CARD','DEBIT','CREDIT','DEBIT_CARD','CREDIT_CARD']),eWalletSales:method(['E_WALLET','EWALLET','GOPAY','OVO','DANA','SHOPEEPAY']),
  grossSales:round(modules.reduce((n,m)=>n+m.grossSales,0)),totalSales:round(modules.reduce((n,m)=>n+m.netRevenue,0)),totalOrders:modules.reduce((n,m)=>n+m.orderCount,0),totalCashIn:sum('cash_in'),totalCashOut:sum('cash_out'),expectedCash:sum('balance'),modules,ledgerEntries:cashRows.reduce((n,r)=>n+r.count,0),canClose:scopeCanClose(s,row)};
 return {...summary,version:hash({...summary,canClose:undefined,cashFingerprints:cashRows.map(r=>r.fingerprint)})};
}
function scopeCanClose(s:WorkspaceScope,row:any){return registerCapabilities(s.role).includes('shift.close')&&(s.role!=='CASHIER'||row.opened_by_user_id===s.actorRef);}
export async function readRegisterShifts(db:Db,s:WorkspaceScope,registerId?:unknown,historyCursor?:unknown,historyLimit:unknown=50){
 requireRegisterCapability(s,'shift.read');requireRegisterCapability(s,'shift_history.read');const limit=Number(historyLimit);if(!Number.isInteger(limit)||limit<1||limit>50)throw new RegisterError(400,'INVALID_SHIFT_HISTORY_LIMIT');const choices=await registers(db,s);
 if(registerId!==undefined&&!choices.some(r=>r.id===registerId))throw new RegisterError(403,'REGISTER_SCOPE_FORBIDDEN');
 let cursor:[string,string]|null=null;
 if(historyCursor!==undefined){try{const decoded=JSON.parse(Buffer.from(String(historyCursor),'base64url').toString('utf8'));if(!Array.isArray(decoded)||decoded.length!==2||!UUID.test(decoded[1])||!Number.isFinite(Date.parse(decoded[0])))throw Error();cursor=[decoded[0],decoded[1]];}catch{throw new RegisterError(400,'INVALID_SHIFT_HISTORY_CURSOR');}}
 const params=[s.tenantId,s.merchantId,s.outletId,s.moduleId,registerId||null];
 const activeRows=(await db.query("SELECT * FROM pos.shifts WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND workspace_modules @> ARRAY[$4]::text[] AND ($5::uuid IS NULL OR register_id=$5) AND status='OPEN' ORDER BY opened_at DESC,id DESC LIMIT 100",params)).rows;
 const closedRows=(await db.query("SELECT * FROM pos.shifts WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND workspace_modules @> ARRAY[$4]::text[] AND ($5::uuid IS NULL OR register_id=$5) AND status='CLOSED' AND ($6::timestamptz IS NULL OR (opened_at,id)<($6::timestamptz,$7::uuid)) ORDER BY opened_at DESC,id DESC LIMIT $8",[...params,cursor?.[0]||null,cursor?.[1]||null,limit+1])).rows;
 const last=closedRows[Math.min(limit-1,closedRows.length-1)],nextHistoryCursor=closedRows.length>limit?Buffer.from(JSON.stringify([iso(last.opened_at),last.id])).toString('base64url'):null;
 const rows=[...activeRows,...closedRows.slice(0,limit)];
 const allowed:any[]=[];for(const r of rows){try{await authorizedModules(db,s,r.workspace_modules);allowed.push(r);}catch(e){if(!(e instanceof ModuleAccessError))throw e;}}
 const active=allowed.filter(r=>r.status==='OPEN');const selected=registerId?active.find(r=>r.register_id===registerId):active.find(r=>r.opened_by_user_id===s.actorRef)||active[0];
 const history=allowed.filter(r=>r.status==='CLOSED').slice(0,100).map(r=>({...r.summary,canClose:false}));
 const events=history.length?(await db.query(`SELECT id,shift_id,action,submission_id,actor_ref,reason,created_at FROM pos.shift_variance_events WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND shift_id=ANY($4::uuid[]) ORDER BY created_at,id`,[s.tenantId,s.merchantId,s.outletId,history.map(r=>r.serverShiftId)])).rows:[];
 await moduleContext(db,s,s.moduleId);return {shift:selected?await registerSnapshot(db,s,selected):null,history,registers:choices,varianceEvents:events,historyTruncated:!!nextHistoryCursor,nextHistoryCursor,capabilities:registerCapabilities(s.role)};
}
export async function closeRegisterShift(db:Db,s:WorkspaceScope,b:any){
 requireRegisterCapability(s,'shift.close');
 if(!ID.test(b.clientShiftId||'')||!UUID.test(b.clientCloseId||'')||typeof b.expectedVersion!=='string'||!/^[a-f0-9]{64}$/.test(b.expectedVersion)||!Number.isFinite(b.actualCash)||b.actualCash<0||b.actualCash>9999999999||Math.abs(b.actualCash*100-Math.round(b.actualCash*100))>0.001||typeof b.notes!=='string'||b.notes.length>500)throw new RegisterError(400,'INVALID_SHIFT_CLOSE');
 const first=(await db.query('SELECT * FROM pos.shifts WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND client_shift_id=$4',[s.tenantId,s.merchantId,s.outletId,b.clientShiftId])).rows[0];if(!first?.workspace_modules)throw new RegisterError(409,'EXPLICIT_REGISTER_SHIFT_REQUIRED');
 await authorizedModules(db,s,first.workspace_modules);if(!scopeCanClose(s,first))throw new RegisterError(403,'SHIFT_OPERATOR_REQUIRED');
 await db.query('SELECT id FROM pos.cash_registers WHERE id=$1 FOR UPDATE',[first.register_id]);const row=(await db.query('SELECT * FROM pos.shifts WHERE id=$1 FOR UPDATE',[first.id])).rows[0];
 const command={clientCloseId:b.clientCloseId,actualCash:round(b.actualCash),notes:b.notes.trim(),expectedVersion:b.expectedVersion};
 if(row.status==='CLOSED'){const same=(await db.query('SELECT close_command=$2::jsonb AS same FROM pos.shifts WHERE id=$1',[row.id,JSON.stringify(command)])).rows[0].same;if(!same)throw new RegisterError(409,'SHIFT_CLOSE_CONFLICT');return {shift:{...row.summary,canClose:false},replayed:true};}
 const current=await registerSnapshot(db,s,row);if(current.version!==b.expectedVersion)throw new RegisterError(409,'DRAWER_CHANGED_RECOUNT_REQUIRED');
 const difference=round(b.actualCash-current.expectedCash);if(difference!==0&&!command.notes)throw new RegisterError(400,'VARIANCE_EXPLANATION_REQUIRED');
 const summary={...current,canClose:false,status:'CLOSED',endTime:new Date().toISOString(),actualCash:command.actualCash,difference,notes:command.notes,closedBy:s.actorRef};
 await db.query(`UPDATE pos.shifts SET status='CLOSED',closed_at=$2,closing_cash=$3,expected_cash=$4,cash_difference=$5,summary=$6::jsonb,notes=$7,closed_by_user_id=$8,close_command=$9::jsonb WHERE id=$1`,[row.id,summary.endTime,summary.actualCash,summary.expectedCash,difference,JSON.stringify(summary),command.notes,s.actorRef,JSON.stringify(command)]);
 if(difference!==0)await db.query(`INSERT INTO pos.shift_variance_events(tenant_id,merchant_id,outlet_id,shift_id,client_command_id,action,actor_ref,reason) VALUES($1,$2,$3,$4,$5,'SUBMIT',$6,$7)`,[s.tenantId,s.merchantId,s.outletId,row.id,'close:'+b.clientCloseId,s.actorRef,command.notes]);
 await audit(db,s,'SHIFT_CLOSED',{shiftId:row.id,registerId:row.register_id,clientCloseId:b.clientCloseId,actualCash:summary.actualCash,expectedCash:summary.expectedCash,difference,notes:summary.notes,moduleIds:row.workspace_modules});return {shift:summary,replayed:false};
}
export function registerCashierFinanceRoutes(app:Express,db:Db){
 const run=(path:string,method:'get'|'post',cap:RegisterCapability,fn:(c:Db,s:WorkspaceScope,req:Request)=>Promise<object>)=>app[method](path,async(req,res)=>{res.setHeader('Cache-Control','no-store');try{const result=await db.tx(async c=>{if(method==='get')await c.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return fn(c,await resolve(c,req,cap),req);});res.json({ok:true,...result,generatedAt:new Date().toISOString()});}catch(e){const known=e instanceof RegisterError||e instanceof ModuleAccessError||e instanceof BillingError;if(!known)console.error('[register-operations]',{message:(e as Error).message,code:(e as any).code});res.status(known?e.status:503).json({ok:false,error:known?e.message:'REGISTER_OPERATIONS_UNAVAILABLE'});}});
 run('/api/v1/finance/outlet','get','outlet_revenue.read',async(c,s,req)=>{
  const requested=req.query.moduleIds===undefined?[s.moduleId]:String(req.query.moduleIds).split(',');const ids=await authorizedModules(c,s,requested);
  const day=String(req.query.businessDate||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)throw new RegisterError(400,'INVALID_BUSINESS_DATE');
  const modules=[];for(const moduleId of ids)modules.push(await financialTotals(c,s,moduleId,null,day));await moduleContext(c,s,s.moduleId);
  return {businessId:s.merchantId,outletId:s.outletId,businessDate:day,timezone:'Asia/Jakarta',from:day+'T00:00:00+07:00',to:new Date(Date.parse(day+'T00:00:00+07:00')+86400000).toISOString(),modules,netRevenue:round(modules.reduce((n,m)=>n+m.netRevenue,0)),orderCount:modules.reduce((n,m)=>n+m.orderCount,0),capabilities:registerCapabilities(s.role)};
 });
 run('/api/v1/finance/registers','get','shift.read',async(c,s)=>({registers:await registers(c,s)}));
 run('/api/v1/finance/registers','post','register.configure',async(c,s,req)=>{
  const b=req.body,ids=await authorizedModules(c,s,b.moduleIds);if(!ids.includes(s.moduleId)||typeof b.name!=='string'||!b.name.trim()||b.name.length>100||!UUID.test(b.registerId||''))throw new RegisterError(400,'INVALID_REGISTER');
  await c.query('SELECT id FROM internal.outlets WHERE id=$1 FOR UPDATE',[s.outletId]);const prev=(await c.query('SELECT * FROM pos.cash_registers WHERE id=$1 FOR UPDATE',[b.registerId])).rows[0];if(prev&&(prev.tenant_id!==s.tenantId||prev.merchant_id!==s.merchantId||prev.outlet_id!==s.outletId||!prev.workspace_modules))throw new RegisterError(403,'REGISTER_SCOPE_FORBIDDEN');if(prev){await authorizedModules(c,s,prev.workspace_modules);if((await c.query("SELECT id FROM pos.shifts WHERE register_id=$1 AND status='OPEN'",[prev.id])).rows.length)throw new RegisterError(409,'REGISTER_HAS_OPEN_SHIFT');}
  const row=(await c.query(`INSERT INTO pos.cash_registers(id,tenant_id,merchant_id,outlet_id,name,workspace_modules) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=excluded.name,workspace_modules=excluded.workspace_modules RETURNING id,name,workspace_modules`,[b.registerId,s.tenantId,s.merchantId,s.outletId,b.name.trim(),ids])).rows[0];await audit(c,s,'REGISTER_CONFIGURED',{registerId:row.id,moduleIds:ids,name:row.name});return {register:row};
 });
 run('/api/v1/finance/shift/variance','post','shift_variance.submit',async(c,s,req)=>{
  const b=req.body;if(!UUID.test(b.shiftId||'')||!UUID.test(b.clientCommandId||'')||!['SUBMIT','APPROVE','REJECT'].includes(b.action)||typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>500)throw new RegisterError(400,'INVALID_VARIANCE_REVIEW');
  const row=(await c.query('SELECT * FROM pos.shifts WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND outlet_id=$4 FOR UPDATE',[b.shiftId,s.tenantId,s.merchantId,s.outletId])).rows[0];if(!row?.workspace_modules||row.status!=='CLOSED'||Number(row.cash_difference)===0)throw new RegisterError(409,'VARIANCE_NOT_AVAILABLE');await authorizedModules(c,s,row.workspace_modules);
  if(b.action==='SUBMIT'){if(s.role==='CASHIER'&&row.opened_by_user_id!==s.actorRef)throw new RegisterError(403,'SHIFT_OPERATOR_REQUIRED');}else requireRegisterCapability(s,'shift_variance.approve');
  const events=(await c.query('SELECT * FROM pos.shift_variance_events WHERE shift_id=$1 ORDER BY created_at,id',[row.id])).rows;
  const prior=events.find(e=>e.client_command_id===b.clientCommandId);if(prior){if(prior.action!==b.action||prior.actor_ref!==s.actorRef||prior.reason!==b.reason.trim()||String(prior.submission_id||'')!==String(b.submissionId||''))throw new RegisterError(409,'VARIANCE_COMMAND_CONFLICT');return {event:prior,replayed:true};}
  const submission=events.filter(e=>e.action==='SUBMIT').at(-1);const decision=submission&&events.find(e=>e.submission_id===submission.id);
  if(b.action==='SUBMIT'&&submission&&decision?.action!=='REJECT'||b.action!=='SUBMIT'&&(!submission||decision||b.submissionId!==submission.id))throw new RegisterError(409,'VARIANCE_REVIEW_CONFLICT');
  const event=(await c.query('INSERT INTO pos.shift_variance_events(tenant_id,merchant_id,outlet_id,shift_id,client_command_id,action,submission_id,actor_ref,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[s.tenantId,s.merchantId,s.outletId,row.id,b.clientCommandId,b.action,b.action==='SUBMIT'?null:submission!.id,s.actorRef,b.reason.trim()])).rows[0];await audit(c,s,'SHIFT_VARIANCE_'+b.action,{shiftId:row.id,eventId:event.id,submissionId:event.submission_id,reason:event.reason,difference:Number(row.cash_difference)});return {event,replayed:false};
 });
}
