import {applyCashEvent,FinanceError} from './finance';
import {FinancialApprovalError} from './financialAuthorization';
import {sharedPurchaseCashCommand} from '../../src/lib/pos/workspacePurchase';
import type {BusinessSector} from '../../src/types';
import type {Express} from 'express';
import type {Db} from '../shared/db';
import {trustedPrincipal} from '../shared/auth';
import {BillingError} from '../billing/engine';
import {ModuleAccessError} from './modules';
import {resolveWorkspaceScope,type WorkspaceScope} from './workspaceScope';
import {ensureInventoryLocation} from './inventoryLocation';
import {commandHash} from './financialAuthorization';
import {workspaceProductRef} from './workspaceIdentity';

export async function workspaceProduct(c:Db,s:WorkspaceScope,recordId:string,lock=false){
 const row=(await c.query(`SELECT * FROM pos.products WHERE tenant_id=$1 AND merchant_id=$2 AND module_id=$3 AND external_ref=$4 AND NOT sync_quarantined ${lock?'FOR UPDATE':''}`,[s.tenantId,s.merchantId,s.moduleId,workspaceProductRef(s.moduleId,recordId)])).rows[0];
 if(!row)throw new ModuleAccessError(404,'WORKSPACE_PRODUCT_NOT_FOUND');
 return row;
}
/** Explicit catalog projection; no stock value from an operational JSON document is authoritative. */
export async function attachWorkspaceInventory(c:Db,s:WorkspaceScope,productId:string,stockable:boolean){
 if(!stockable)return;
 const p=(await c.query('SELECT * FROM pos.products WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND module_id=$4 FOR UPDATE',[productId,s.tenantId,s.merchantId,s.moduleId])).rows[0];
 if(!p)throw new ModuleAccessError(404,'WORKSPACE_PRODUCT_NOT_FOUND');
 if(!p.inventory_item_id){
  const i=(await c.query(`INSERT INTO pos.inventory_items(tenant_id,merchant_id,module_id,item_name,sku,base_unit,item_type,cost_per_unit,is_stockable) VALUES($1,$2,$3,$4,$5,$6,'RETAIL_FINISHED',$7,true) RETURNING id`,[s.tenantId,s.merchantId,s.moduleId,p.name,s.moduleId+':'+p.sku,p.unit||'pcs',p.cost_price])).rows[0];
  await c.query("UPDATE pos.products SET inventory_item_id=$2,offering_type='PHYSICAL' WHERE id=$1",[p.id,i.id]);
 }
}
export async function lockWorkspaceStock(c:Db,s:WorkspaceScope,p:any){
 if(!p.inventory_item_id)return null;
 const location=await ensureInventoryLocation(c,s.tenantId,s.merchantId,s.outletId);
 await c.query(`INSERT INTO pos.inventory_balances(tenant_id,merchant_id,outlet_id,location_id,inventory_item_id,current_stock) VALUES($1,$2,$3,$4,$5,0) ON CONFLICT(outlet_id,location_id,inventory_item_id) DO NOTHING`,[s.tenantId,s.merchantId,s.outletId,location,p.inventory_item_id]);
 const row=(await c.query(`SELECT current_stock FROM pos.inventory_balances WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND location_id=$5 AND inventory_item_id=$6 FOR UPDATE`,[s.tenantId,s.merchantId,s.outletId,s.moduleId,location,p.inventory_item_id])).rows[0];
 if(!row)throw new ModuleAccessError(409,'STOCK_WORKSPACE_MISMATCH');
 return {location,quantity:Number(row.current_stock)};
}
async function movement(c:Db,s:WorkspaceScope,item:string,location:string,qty:number,type:string,ref:string){
 await c.query(`INSERT INTO pos.inventory_transactions(tenant_id,merchant_id,outlet_id,module_id,location_id,inventory_item_id,quantity_delta,reference_type,reference_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'Explicit workspace inventory command')`,[s.tenantId,s.merchantId,s.outletId,s.moduleId,location,item,qty,type,ref]);
}
export function registerWorkspaceInventoryRoutes(app:Express,db:Db){
 app.post('/api/v1/sync/modules/inventory',async(req,res)=>{
  const principal=trustedPrincipal(req);if(!principal)return res.status(401).json({ok:false,error:'UNAUTHENTICATED'});
  const b=req.body;
  if(!b||!['RECEIVE','TRANSFER','ADJUST'].includes(b.action)||typeof b.commandId!=='string'||!/^[^\x00-\x1f\x7f]{1,128}$/.test(b.commandId)||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100||b.lines.some((l:any)=>!l||typeof l.productRef!=='string'||!l.productRef||!Number.isFinite(l.quantity)||(b.action==='ADJUST'?l.quantity<0:l.quantity<=0)||l.quantity>999999||Math.abs(l.quantity*1000-Math.round(l.quantity*1000))>0.001))return res.status(400).json({ok:false,error:'INVALID_STOCK_COMMAND'});
  try{
   const result=await db.tx(async c=>{
    const initial=await resolveWorkspaceScope(c,principal.subject,b,['inventory']);
    // One lock covers receipt and movements. A lost ACK or simultaneous retry cannot post twice.
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[initial.tenantId+':'+b.commandId]);
    for(const moduleId of new Set(b.lines.map((l:any)=>l.moduleId||b.moduleId)))await resolveWorkspaceScope(c,principal.subject,{...b,moduleId},['inventory']);
    if(b.action==='TRANSFER')await resolveWorkspaceScope(c,principal.subject,{...b,outletId:b.destinationOutletId},['inventory']);
    await resolveWorkspaceScope(c,principal.subject,b,['inventory']);
    const hash=commandHash(b),prior=(await c.query('SELECT * FROM pos.workspace_commands WHERE tenant_id=$1 AND command_id=$2',[initial.tenantId,b.commandId])).rows[0];
    if(prior){if(prior.actor_ref!==principal.subject||prior.request_hash!==hash||prior.merchant_id!==initial.merchantId)throw new ModuleAccessError(409,'STOCK_COMMAND_ID_CONFLICT');return {...prior.result,replayed:true};}
    if(b.action==='TRANSFER'&&(b.lines.some((l:any)=>l.moduleId&&l.moduleId!==b.moduleId)||b.destinationOutletId===b.outletId))throw new ModuleAccessError(400,'INVALID_TRANSFER_SCOPE');
    const scopes=new Map<string,WorkspaceScope>();
    const sorted=[...b.lines].sort((a:any,z:any)=>String(a.moduleId||b.moduleId).localeCompare(String(z.moduleId||b.moduleId))||a.productRef.localeCompare(z.productRef));
    for(const line of sorted){
     const scope=await resolveWorkspaceScope(c,principal.subject,{...b,moduleId:line.moduleId||b.moduleId},['inventory']);scopes.set(scope.moduleId,scope);
     const p=await workspaceProduct(c,scope,line.productRef,true);if(!p.inventory_item_id)throw new ModuleAccessError(409,'PRODUCT_NOT_STOCKABLE');
     const stock=await lockWorkspaceStock(c,scope,p);if(!stock)throw new ModuleAccessError(409,'PRODUCT_NOT_STOCKABLE');
     if(b.action==='ADJUST'){if(!Number.isFinite(line.expectedQuantity)||stock.quantity!==line.expectedQuantity)throw new ModuleAccessError(409,'STOCK_CHANGED_REVIEW_REQUIRED');await movement(c,scope,p.inventory_item_id,stock.location,line.quantity-stock.quantity,'ADJUSTMENT',b.commandId);}
     else if(b.action==='TRANSFER'){
      if(stock.quantity<line.quantity)throw new ModuleAccessError(409,'INSUFFICIENT_STOCK');
      // Validate destination separately, then restore source context for each ledger append.
      const destination=await resolveWorkspaceScope(c,principal.subject,{...b,outletId:b.destinationOutletId},['inventory']);
      const destLocation=await ensureInventoryLocation(c,destination.tenantId,destination.merchantId,destination.outletId);
      await resolveWorkspaceScope(c,principal.subject,b,['inventory']);
      await movement(c,scope,p.inventory_item_id,stock.location,-line.quantity,'TRANSFER_OUT',b.commandId);
      await resolveWorkspaceScope(c,principal.subject,{...b,outletId:b.destinationOutletId},['inventory']);
      await movement(c,destination,p.inventory_item_id,destLocation,line.quantity,'TRANSFER_IN',b.commandId);
     }else await movement(c,scope,p.inventory_item_id,stock.location,line.quantity,'PURCHASE',b.commandId);
    }
    const expenses:Array<{moduleId:string;amount:number;cashEventId:string}>=[];
    if(b.purchase){
     const p=b.purchase,allocations=p.allocations;
     if(b.action!=='RECEIVE'||b.commandId.length>80||!Number.isFinite(p.totalAmount)||p.totalAmount<=0||!Array.isArray(allocations)||allocations.length!==scopes.size||new Set(allocations.map((a:any)=>a.moduleId)).size!==scopes.size||allocations.some((a:any)=>!scopes.has(a.moduleId)||!Number.isFinite(a.amount)||a.amount<=0||Math.abs(a.amount*100-Math.round(a.amount*100))>0.001)||Math.round(allocations.reduce((n:number,a:any)=>n+a.amount,0)*100)!==Math.round(p.totalAmount*100)||typeof p.occurredAt!=='string'||!Number.isFinite(Date.parse(p.occurredAt))||typeof p.description!=='string'||!p.description.trim()||p.description.length>500)throw new ModuleAccessError(400,'EXACT_PURCHASE_ALLOCATION_REQUIRED');
     for(const allocation of allocations){const s=await resolveWorkspaceScope(c,principal.subject,{...b,moduleId:allocation.moduleId},['inventory','pos']);const command=sharedPurchaseCashCommand(b.commandId,s.moduleId,s.outletId,s.sector as BusinessSector,allocation.amount,p.occurredAt,p.description);const expense=await applyCashEvent(c,{...s,sector:s.sector as BusinessSector},{...command,approvalGrant:allocation.approvalGrant});expenses.push({moduleId:s.moduleId,amount:allocation.amount,cashEventId:expense.id});}
    }
    await resolveWorkspaceScope(c,principal.subject,b,['inventory']);
    const result={commandId:b.commandId,action:b.action,lineCount:b.lines.length,moduleIds:[...scopes.keys()],expenses,financialRecorded:expenses.length>0,replayed:false};
    await c.query('INSERT INTO pos.workspace_commands(tenant_id,merchant_id,command_id,actor_ref,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)',[initial.tenantId,initial.merchantId,b.commandId,principal.subject,hash,result]);
    return result;
   });res.setHeader('Cache-Control','no-store');return res.json({ok:true,...result});
  }catch(e){const known=e instanceof ModuleAccessError||e instanceof BillingError||e instanceof FinanceError||e instanceof FinancialApprovalError;return res.status(known?e.status:503).json({ok:false,error:known?e.message:'WORKSPACE_INVENTORY_UNAVAILABLE'});}
 });
}
