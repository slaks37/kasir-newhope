import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Db} from '../../services/shared/db';
/** Real HTTP commands + canonical effects; shared by embedded and PostgreSQL17 service-login runs. */
export async function recipeAcceptance(admin:Db,request:any,scope:any,save:any,sale:any){
 const s=scope('barber'),path='/api/v1/sync/modules/recipes';
 const command=(action:string,body:any)=>({...s,commandId:randomUUID(),action,...body});
 const create=command('CREATE_INGREDIENT',{name:'Synthetic measured consumable',sku:randomUUID(),unit:'ml',cost:2});
 assert.equal((await request(path,create,'cashierA')).status,403);
 let r=await request(path,create,'manager');assert.equal(r.status,200,JSON.stringify(r));const ingredientId=r.data.entityId;
 assert.equal((await request(path,create,'manager')).data.entityId,ingredientId,'A lost ingredient ACK cannot duplicate its catalogue entry');
 assert.equal((await request(path,{...create,name:'Changed command'},'manager')).status,409);
 const receipt=command('RECEIVE_INGREDIENT',{ingredientId,quantity:10});r=await request(path,receipt,'manager');assert.equal(r.status,200,JSON.stringify(r));assert.equal((await request(path,receipt,'manager')).data.replayed,true);
 const balance=async()=>Number((await admin.query('SELECT COALESCE(SUM(current_stock),0) quantity FROM pos.inventory_balances WHERE inventory_item_id=$1 AND outlet_id=$2',[ingredientId,s.outletId])).rows[0].quantity);
 assert.equal(await balance(),10);
 assert.equal((await request(path,{...command('RECEIVE_INGREDIENT',{ingredientId,quantity:100}),moduleId:'retail'},'manager')).status,404);
 assert.equal((await save(s,'products','recipe-service',{id:'recipe-service',name:'Synthetic recipe service',sku:randomUUID(),price:100,costPrice:2,inventoryTracked:false},'manager')).status,200);
 const recipe=command('SET_RECIPE',{productRef:'recipe-service',baseRevision:0,yieldQuantity:3,lines:[{ingredientId,quantity:1,wastagePercentage:0}]});
 r=await request(path,recipe,'manager');assert.equal(r.status,200,JSON.stringify(r));const recipeId=r.data.entityId;
 assert.equal((await request(path,recipe,'manager')).data.replayed,true);
 assert.equal((await request(path,{...recipe,commandId:randomUUID()},'manager')).status,409,'Catalogue CAS protects recipes');
 const payload=sale(s,randomUUID(),3);payload.transactions[0].items[0].productRef='recipe-service';
 r=await request('/api/v1/sync/transactions',payload,'cashierA');assert.equal(r.data.accepted,1,JSON.stringify(r));assert.equal(await balance(),9);
 const lineCost=Number((await admin.query('SELECT ti.unit_cost FROM pos.transaction_items ti JOIN pos.transactions t ON t.id=ti.transaction_id WHERE t.client_txn_id=$1',[payload.transactions[0].clientTxnId])).rows[0].unit_cost);assert.equal(lineCost,0.67,'HPP derives from the exact consumed materials');
 assert.equal((await request('/api/v1/sync/transactions',payload,'cashierA')).data.replayed,true);assert.equal(await balance(),9);
 r=await request(path,{...recipe,commandId:randomUUID(),baseRevision:1,lines:[{ingredientId,quantity:2,wastagePercentage:0}]},'manager');assert.equal(r.status,200,JSON.stringify(r));
 const refund=async(quantity:number,target=payload)=>{
  const refund={clientRefundId:randomUUID(),occurredAt:new Date().toISOString(),refundMethod:'CASH',reason:'Synthetic immutable recipe return',items:[{clientItemId:'line',quantity}]};
  const approved=await request('/api/v1/finance/approve',{...s,action:'REFUND',reference:target.transactions[0].clientTxnId,reason:refund.reason,command:refund,pin:'5926'},'manager');assert.equal(approved.status,200,JSON.stringify(approved));
  const body={...s,clientTxnId:target.transactions[0].clientTxnId,refund:{...refund,approvalGrant:approved.data.approvalGrant}};
  const result=await request('/api/v1/finance/refund',body,'manager');assert.equal(result.status,200,JSON.stringify(result));assert.equal((await request('/api/v1/finance/refund',body,'manager')).data.refund.replayed,true);
 };
 await refund(1);assert.equal(await balance(),9.333,'Refund uses sold recipe, not its new version');
 await refund(1);assert.equal(await balance(),9.667,'Cumulative rounding preserves fractions');
 await refund(1);assert.equal(await balance(),10,'Final refund restores exactly the original deduction');
 const oversell=sale(s,randomUUID(),30);oversell.transactions[0].items[0].productRef='recipe-service';r=await request('/api/v1/sync/transactions',oversell,'cashierA');assert.equal(r.data.accepted,0,JSON.stringify(r));assert.equal(r.data.rejected[0].error,'INSUFFICIENT_INGREDIENT_STOCK_REQUIRES_REVIEW');assert.equal(await balance(),10);
 assert.equal((await admin.query('SELECT count(*)::int n FROM pos.transactions WHERE client_txn_id=$1',[oversell.transactions[0].clientTxnId])).rows[0].n,0,'Insufficient ingredients roll back payment, items and transaction');
 const partial=sale(s,randomUUID(),3);partial.transactions[0].items[0].productRef='recipe-service';r=await request('/api/v1/sync/transactions',partial,'cashierA');assert.equal(r.data.accepted,1,JSON.stringify(r));assert.equal(await balance(),8);
 await refund(1,partial);assert.equal(await balance(),8.667);
 const cancellation={...partial.transactions[0],paymentStatus:'CANCELLED',voidReason:'Synthetic recipe void after partial refund',voidedAt:new Date().toISOString()};
 const approval=await request('/api/v1/finance/approve',{...s,action:'VOID',reference:cancellation.clientTxnId,reason:cancellation.voidReason,command:cancellation,pin:'5926'},'manager');assert.equal(approval.status,200,JSON.stringify(approval));
 const voidCommand={...partial,idempotencyKey:randomUUID(),transactions:[{...cancellation,approvalGrant:approval.data.approvalGrant}]};r=await request('/api/v1/sync/transactions',voidCommand,'manager');assert.equal(r.data.voided,1,JSON.stringify(r));assert.equal(await balance(),10,'Void restores only the quantity not already refunded');assert.equal((await request('/api/v1/sync/transactions',voidCommand,'manager')).data.replayed,true);assert.equal(await balance(),10);
 const ledger=Number((await admin.query('SELECT COALESCE(SUM(quantity_delta),0) n FROM pos.inventory_transactions WHERE inventory_item_id=$1 AND outlet_id=$2',[ingredientId,s.outletId])).rows[0].n);assert.equal(ledger,await balance(),'Canonical balance equals ledger after fractional refund and void');
 const snapshot=(await admin.query('SELECT s.* FROM pos.workspace_recipe_consumption s WHERE s.recipe_id=$1',[recipeId])).rows;assert.equal(snapshot.length,2);assert(snapshot.some((r:any)=>Number(r.recipe_revision)===1));
 await assert.rejects(()=>admin.query('UPDATE pos.workspace_recipe_consumption SET quantity=99 WHERE id=$1',[snapshot[0].id]),/RECIPE_CONSUMPTION_IMMUTABLE/);
 return {canonicalIngredientReceipts:true,recipeRevisionCAS:true,atomicSaleBOM:true,immutableRecipeRefunds:true,cumulativeRounding:true,insufficientStockRollback:true,scopeDenials:true,idempotentReplay:true};
}
