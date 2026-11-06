import type {Express} from 'express';
import type {Db} from '../shared/db';
import {trustedPrincipal} from '../shared/auth';
import {hasSchemaFeature} from '../shared/schemaFeatures';
import {BillingError} from '../billing/engine';
import {ModuleAccessError} from './modules';
import {resolveWorkspaceScope,requireWorkspaceRole,type WorkspaceScope} from './workspaceScope';
import {workspaceProduct,lockWorkspaceStock} from './workspaceInventory';
import {commandHash} from './financialAuthorization';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const positive=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<=999999&&Math.abs(n*10000-Math.round(n*10000))<0.001;
const text=(n:unknown,max:number)=>typeof n==='string'&&!!n.trim()&&n.length<=max&&!/[\x00-\x1f\x7f]/.test(n);
const manager=(s:WorkspaceScope)=>{requireWorkspaceRole(s,['OWNER','ADMIN','MANAGER']);if(!['TENANT','MERCHANT'].includes(s.membershipScope))throw new ModuleAccessError(403,'MODULE_CATALOG_MANAGER_REQUIRED');};

type RecipePlan={recipe:any;inputs:Array<{inventoryItemId:string;location:string;quantity:number;unitCost:string}>;unitCost:number};
/** Lock the canonical recipe and stock before writing the immutable sale line. */
export async function prepareWorkspaceRecipe(c:Db,s:WorkspaceScope,productId:string,quantity:number):Promise<RecipePlan|null>{
 if(!await hasSchemaFeature(c,'workspaceRecipes'))return null;
 const recipe=(await c.query(`SELECT * FROM pos.recipes WHERE tenant_id=$1 AND merchant_id=$2 AND module_id=$3 AND output_product_id=$4 AND is_active FOR SHARE`,[s.tenantId,s.merchantId,s.moduleId,productId])).rows[0];
 if(!recipe)return null;
 const inputs=(await c.query(`SELECT ri.*,i.id AS inventory_item_id,i.module_id,i.tenant_id,i.merchant_id,i.base_unit,i.is_stockable,i.cost_per_unit FROM pos.recipe_items ri JOIN pos.inventory_items i ON i.id=ri.inventory_item_id WHERE recipe_id=$1 ORDER BY i.id FOR SHARE OF ri,i`,[recipe.id])).rows;
 if(!inputs.length)throw new ModuleAccessError(409,'RECIPE_EMPTY_REVIEW_REQUIRED');
 const planned:RecipePlan['inputs']=[];
 for(const input of inputs){
  if(input.tenant_id!==s.tenantId||input.merchant_id!==s.merchantId||input.module_id!==s.moduleId||!input.is_stockable||input.unit!==input.base_unit)throw new ModuleAccessError(409,'RECIPE_INGREDIENT_SCOPE_OR_UNIT_MISMATCH');
  // Round once at the canonical balance's three-decimal precision.
  const qty=Number((await c.query('SELECT round($1::numeric*$2::numeric/$3::numeric*(1+$4::numeric/100),3) AS qty',[quantity,input.quantity,recipe.yield_quantity,input.wastage_percentage])).rows[0].qty);
  if(qty<=0||qty>99999999)throw new ModuleAccessError(409,'RECIPE_QUANTITY_OUT_OF_RANGE');
  const stock=await lockWorkspaceStock(c,s,input);
  if(!stock||stock.quantity<qty)throw new ModuleAccessError(409,'INSUFFICIENT_INGREDIENT_STOCK_REQUIRES_REVIEW');
  planned.push({inventoryItemId:input.inventory_item_id,location:stock.location,quantity:qty,unitCost:input.cost_per_unit});
 }
 const cost=planned.reduce((sum,i)=>sum+i.quantity*Number(i.unitCost),0);
 return {recipe,inputs:planned,unitCost:Math.round((cost/quantity+Number.EPSILON)*100)/100};
}
/** Snapshot and deduction are inside the sale savepoint; recipe edits cannot rewrite them. */
export async function consumeWorkspaceRecipe(c:Db,s:WorkspaceScope,lineId:string,transactionId:string,plan:RecipePlan|null){
 if(!plan)return;
 for(const input of plan.inputs){
  const snapshot=(await c.query(`INSERT INTO pos.workspace_recipe_consumption(tenant_id,merchant_id,outlet_id,module_id,transaction_item_id,recipe_id,recipe_revision,inventory_item_id,location_id,quantity,unit_cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[s.tenantId,s.merchantId,s.outletId,s.moduleId,lineId,plan.recipe.id,plan.recipe.workspace_revision,input.inventoryItemId,input.location,input.quantity,input.unitCost])).rows[0];
  await c.query(`INSERT INTO pos.inventory_transactions(tenant_id,merchant_id,outlet_id,module_id,location_id,inventory_item_id,quantity_delta,reference_type,reference_id,reason,recipe_consumption_id) VALUES($1,$2,$3,$4,$5,$6,$7,'SALE_RECIPE_DEDUCT',$8,'Canonical recipe consumption',$9)`,[s.tenantId,s.merchantId,s.outletId,s.moduleId,input.location,input.inventoryItemId,-input.quantity,transactionId,snapshot.id]);
 }
}
/** Cumulative rounding gives exact final restoration even with many partial refunds. */
export async function restoreWorkspaceRecipe(c:Db,lineId:string,reference:string,voided=false){
 if(!await hasSchemaFeature(c,'workspaceRecipes'))return;
 const rows=(await c.query(`SELECT s.*,COALESCE(li.quantity_exact,li.quantity) AS sold_quantity,COALESCE((SELECT SUM(ri.quantity) FROM pos.transaction_refund_items ri WHERE ri.transaction_item_id=li.id),0) AS returned_quantity,COALESCE((SELECT SUM(m.quantity_delta) FROM pos.inventory_transactions m WHERE m.recipe_consumption_id=s.id),0) AS net FROM pos.workspace_recipe_consumption s JOIN pos.transaction_items li ON li.id=s.transaction_item_id WHERE s.transaction_item_id=$1 ORDER BY s.inventory_item_id`,[lineId])).rows;
 for(const row of rows){
  const delta=(await c.query(`SELECT GREATEST(0,LEAST(-$1::numeric,round($2::numeric*LEAST($3::numeric,$4::numeric)/$4::numeric,3)-($2::numeric+$1::numeric))) AS qty`,[row.net,row.quantity,voided?row.sold_quantity:row.returned_quantity,row.sold_quantity])).rows[0].qty;
  if(Number(delta)>0)await c.query(`INSERT INTO pos.inventory_transactions(tenant_id,merchant_id,outlet_id,module_id,location_id,inventory_item_id,quantity_delta,reference_type,reference_id,reason,recipe_consumption_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'Restore original recipe snapshot',$10)`,[row.tenant_id,row.merchant_id,row.outlet_id,row.module_id,row.location_id,row.inventory_item_id,delta,voided?'VOID_RECIPE_RESTORE':'REFUND_RECIPE_RESTORE',reference,row.id]);
 }
}
export function registerWorkspaceRecipeRoutes(app:Express,db:Db){
 app.get('/api/v1/sync/modules/recipes',async(req,res)=>{
  const p=trustedPrincipal(req);if(!p)return res.status(401).json({ok:false,error:'UNAUTHENTICATED'});
  try{const result=await db.tx(async c=>{
   const s=await resolveWorkspaceScope(c,p.subject,req.query,['inventory']);manager(s);
   if(!await hasSchemaFeature(c,'workspaceRecipes'))throw new ModuleAccessError(503,'WORKSPACE_RECIPES_SCHEMA_REQUIRED');
   const ingredients=(await c.query(`SELECT i.id,i.item_name AS name,i.base_unit AS unit,i.cost_per_unit AS cost,COALESCE(b.quantity,0) AS quantity FROM pos.inventory_items i LEFT JOIN LATERAL(SELECT SUM(current_stock) quantity FROM pos.inventory_balances WHERE inventory_item_id=i.id AND outlet_id=$4) b ON true WHERE i.tenant_id=$1 AND i.merchant_id=$2 AND i.module_id=$3 AND i.item_type IN('RAW_MATERIAL','CONSUMABLE','PACKAGING') ORDER BY i.item_name,i.id`,[s.tenantId,s.merchantId,s.moduleId,s.outletId])).rows;
   const recipes=(await c.query(`SELECT r.id,r.output_product_id AS product_id,p.external_ref,p.workspace_payload->>'id' AS product_ref,r.workspace_revision AS revision,r.is_active,r.yield_quantity,COALESCE(jsonb_agg(jsonb_build_object('ingredientId',ri.inventory_item_id,'quantity',ri.quantity,'unit',ri.unit,'wastagePercentage',ri.wastage_percentage)) FILTER(WHERE ri.id IS NOT NULL),'[]'::jsonb) AS lines FROM pos.recipes r JOIN pos.products p ON p.id=r.output_product_id LEFT JOIN pos.recipe_items ri ON ri.recipe_id=r.id WHERE r.tenant_id=$1 AND r.merchant_id=$2 AND r.module_id=$3 GROUP BY r.id,p.external_ref,p.workspace_payload ORDER BY r.id`,[s.tenantId,s.merchantId,s.moduleId])).rows;
   return {ingredients,recipes};
  });res.setHeader('Cache-Control','no-store');return res.json({ok:true,...result});}catch(e){return failure(res,e);}
 });
 app.post('/api/v1/sync/modules/recipes',async(req,res)=>{
  const p=trustedPrincipal(req);if(!p)return res.status(401).json({ok:false,error:'UNAUTHENTICATED'});
  const b=req.body;if(!b||!text(b.commandId,128)||!['CREATE_INGREDIENT','RECEIVE_INGREDIENT','SET_RECIPE'].includes(b.action))return res.status(400).json({ok:false,error:'INVALID_RECIPE_COMMAND'});
  try{const result=await db.tx(async c=>{
   const s=await resolveWorkspaceScope(c,p.subject,b,['inventory']);manager(s);
   if(!await hasSchemaFeature(c,'workspaceRecipes'))throw new ModuleAccessError(503,'WORKSPACE_RECIPES_SCHEMA_REQUIRED');
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[s.tenantId+':'+b.commandId]);
   const hash=commandHash(b),prior=(await c.query('SELECT * FROM pos.workspace_commands WHERE tenant_id=$1 AND command_id=$2',[s.tenantId,b.commandId])).rows[0];
   if(prior){if(prior.actor_ref!==p.subject||prior.merchant_id!==s.merchantId||prior.request_hash!==hash)throw new ModuleAccessError(409,'RECIPE_COMMAND_ID_CONFLICT');return {...prior.result,replayed:true};}
   let entityId:string,revision:number|undefined;
   if(b.action==='CREATE_INGREDIENT'){
    if(!text(b.name,100)||!text(b.unit,20)||!text(b.sku,50)||typeof b.cost!=='number'||!Number.isFinite(b.cost)||b.cost<0||b.cost>999999)throw new ModuleAccessError(400,'INVALID_INGREDIENT');
    entityId=(await c.query(`INSERT INTO pos.inventory_items(tenant_id,merchant_id,module_id,item_name,sku,base_unit,item_type,cost_per_unit,is_stockable) VALUES($1,$2,$3,$4,$5,$6,'RAW_MATERIAL',$7,true) RETURNING id`,[s.tenantId,s.merchantId,s.moduleId,b.name.trim(),s.moduleId+':'+b.sku,b.unit.trim(),b.cost])).rows[0].id;
   }else if(b.action==='RECEIVE_INGREDIENT'){
    if(!UUID.test(b.ingredientId)||(!positive(b.quantity)||Math.abs(b.quantity*1000-Math.round(b.quantity*1000))>0.001))throw new ModuleAccessError(400,'INVALID_INGREDIENT_RECEIPT');
    const input=(await c.query(`SELECT id AS inventory_item_id FROM pos.inventory_items WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND module_id=$4 AND item_type IN('RAW_MATERIAL','CONSUMABLE','PACKAGING') AND is_stockable FOR UPDATE`,[b.ingredientId,s.tenantId,s.merchantId,s.moduleId])).rows[0];if(!input)throw new ModuleAccessError(404,'WORKSPACE_INGREDIENT_NOT_FOUND');
    const stock=await lockWorkspaceStock(c,s,input);
    await c.query(`INSERT INTO pos.inventory_transactions(tenant_id,merchant_id,outlet_id,module_id,location_id,inventory_item_id,quantity_delta,reference_type,reference_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,'PURCHASE',$8,'Ingredient receipt')`,[s.tenantId,s.merchantId,s.outletId,s.moduleId,stock!.location,input.inventory_item_id,b.quantity,b.commandId]);entityId=input.inventory_item_id;
   }else{
    if(typeof b.productRef!=='string'||!Number.isSafeInteger(b.baseRevision)||b.baseRevision<0||!positive(b.yieldQuantity)||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100||new Set(b.lines.map((l:any)=>l?.ingredientId)).size!==b.lines.length||b.lines.some((l:any)=>!l||!UUID.test(l.ingredientId)||!positive(l.quantity)||typeof l.wastagePercentage!=='number'||!Number.isFinite(l.wastagePercentage)||l.wastagePercentage<0||l.wastagePercentage>100))throw new ModuleAccessError(400,'INVALID_RECIPE');
    const product=await workspaceProduct(c,s,b.productRef,true);if(product.inventory_item_id)throw new ModuleAccessError(409,'FINISHED_STOCK_AND_RECIPE_ARE_EXCLUSIVE');
    const existing=(await c.query(`SELECT * FROM pos.recipes WHERE merchant_id=$1 AND output_product_id=$2 FOR UPDATE`,[s.merchantId,product.id])).rows[0];
    if(existing&&(existing.module_id!==s.moduleId||Number(existing.workspace_revision)!==b.baseRevision)||!existing&&b.baseRevision!==0)throw new ModuleAccessError(409,'RECIPE_REVISION_CONFLICT');
    const recipe=(await c.query(`INSERT INTO pos.recipes(tenant_id,merchant_id,module_id,output_product_id,recipe_name,yield_quantity,yield_unit) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(merchant_id,output_product_id) DO UPDATE SET yield_quantity=excluded.yield_quantity,workspace_revision=pos.recipes.workspace_revision+1,is_active=true,updated_at=now() RETURNING id,workspace_revision`,[s.tenantId,s.merchantId,s.moduleId,product.id,product.name,b.yieldQuantity,product.unit||'portion'])).rows[0];
    await c.query('DELETE FROM pos.recipe_items WHERE recipe_id=$1',[recipe.id]);
    for(const l of [...b.lines].sort((a:any,z:any)=>a.ingredientId.localeCompare(z.ingredientId))){const input=(await c.query(`SELECT * FROM pos.inventory_items WHERE id=$1 AND tenant_id=$2 AND merchant_id=$3 AND module_id=$4 AND item_type IN('RAW_MATERIAL','CONSUMABLE','PACKAGING') AND is_stockable FOR SHARE`,[l.ingredientId,s.tenantId,s.merchantId,s.moduleId])).rows[0];if(!input)throw new ModuleAccessError(404,'WORKSPACE_INGREDIENT_NOT_FOUND');await c.query(`INSERT INTO pos.recipe_items(recipe_id,inventory_item_id,quantity,unit,wastage_percentage) VALUES($1,$2,$3,$4,$5)`,[recipe.id,input.id,l.quantity,input.base_unit,l.wastagePercentage]);}
    entityId=recipe.id;revision=Number(recipe.workspace_revision);
   }
   const result={commandId:b.commandId,action:b.action,entityId,revision,workspace:{tenantId:s.tenantId,merchantId:s.merchantId,outletId:s.outletId,moduleId:s.moduleId,actorRef:s.actorRef},replayed:false};
   await c.query('INSERT INTO pos.workspace_commands(tenant_id,merchant_id,command_id,actor_ref,request_hash,result) VALUES($1,$2,$3,$4,$5,$6)',[s.tenantId,s.merchantId,b.commandId,p.subject,hash,result]);return result;
  });res.setHeader('Cache-Control','no-store');return res.json({ok:true,...result});}catch(e){return failure(res,e);}
 });
}
function failure(res:any,e:unknown){const known=e instanceof ModuleAccessError||e instanceof BillingError;return res.status(known?e.status:503).json({ok:false,error:known?e.message:'WORKSPACE_RECIPES_UNAVAILABLE'});}
