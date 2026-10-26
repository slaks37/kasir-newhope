import type {Express} from 'express';
import type {Db} from '../shared/db';
import {trustedPrincipal} from '../shared/auth';
import {ModuleAccessError,moduleStateRequirements} from './modules';
import {resolveWorkspaceScope,type WorkspaceScope} from './workspaceScope';
import {validOperations,HISTORY_WINDOWS} from './sharedState';
import {workspaceProductRef} from './workspaceIdentity';
import {attachWorkspaceInventory} from './workspaceInventory';
const exclusive:Record<string,string>={kds_tickets:'fnb',carwash_queue:'carwash',bookings:'barber'};
export function assertWorkspaceKinds(scope:WorkspaceScope,kinds:string[],write=false){
 const requirements=moduleStateRequirements(kinds,write);
 if(requirements.some(choices=>!choices.some(p=>scope.permissions.includes(p)&&scope.features.includes(p))))throw new ModuleAccessError(403,'WORKSPACE_PERMISSION_DENIED');
 if(kinds.some(kind=>exclusive[kind]&&exclusive[kind]!==scope.moduleId))throw new ModuleAccessError(403,'OPERATIONAL_MODULE_MISMATCH');
 if(write&&kinds.some(kind=>['stock_items','bundles','inventory_logs'].includes(kind)))throw new ModuleAccessError(403,'CANONICAL_WORKSPACE_COMMAND_REQUIRED');
 if(write&&kinds.some(kind=>kind==='users'||kind==='staff_members'))throw new ModuleAccessError(403,'IDENTITY_RECORDS_ARE_SERVER_OWNED');
}
function errorResponse(res:any,e:unknown){if(!(e instanceof ModuleAccessError)){const d=e as any;console.error('[workspace-state]',{message:d.message,code:d.code,constraint:d.constraint});}return res.status(e instanceof ModuleAccessError?e.status:503).json({ok:false,error:e instanceof ModuleAccessError?e.message:'WORKSPACE_STATE_UNAVAILABLE'});}
export function registerWorkspaceStateRoutes(app:Express,db:Db){
 app.get('/api/v1/sync/modules/state',async(req,res)=>{
  const principal=trustedPrincipal(req);if(!principal)return res.status(401).json({ok:false,error:'UNAUTHENTICATED'});
  try{const result=await db.tx(async c=>{
   await c.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const scope=await resolveWorkspaceScope(c,principal.subject,req.query);
   const kinds=typeof req.query.kinds==='string'?[...new Set(req.query.kinds.split(','))]:[];
   if(!kinds.length||kinds.length>25)throw new ModuleAccessError(400,'EXPLICIT_STATE_KINDS_REQUIRED');assertWorkspaceKinds(scope,kinds);
   const cursor=typeof req.query.cursor==='string'?req.query.cursor:'';if(cursor.length>300)throw new ModuleAccessError(400,'INVALID_STATE_CURSOR');
   const window=Object.entries(HISTORY_WINDOWS).filter(([,w])=>w.days).map(([kind,w])=>`(kind<>'${kind}' OR updated_at>now()-interval '${w.days} days')`).join(' AND ');
   const rows=(await c.query(`SELECT * FROM(
    SELECT scope,kind,record_id,value,revision,deleted FROM pos.shared_state_records WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND scope=$5 AND kind=ANY($6::text[]) AND kind NOT IN('products','inventory_logs') AND ${window} AND(kind<>'inventory_logs' OR record_id IN(SELECT record_id FROM pos.shared_state_records WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND kind='inventory_logs' ORDER BY updated_at DESC LIMIT 2000))
    UNION ALL
    SELECT $5::text,'products'::text,p.workspace_payload->>'id',p.workspace_payload||jsonb_build_object('tenantId',$1::text,'businessId',$8::text,'moduleId',$4::text,'outletId',$3::text,'branchId',$3::text,'businessSector',$9::text,'name',p.name,'price',p.price,'costPrice',p.cost_price,'sku',p.sku,'isAvailable',p.is_available,'catalogRevision',p.workspace_revision,'stock',COALESCE((SELECT sum(current_stock) FROM pos.inventory_balances WHERE inventory_item_id=p.inventory_item_id AND outlet_id=$3),0),'inventoryTracked',p.inventory_item_id IS NOT NULL),p.workspace_revision,false
    FROM pos.products p WHERE p.tenant_id=$1 AND p.merchant_id=$2 AND p.module_id=$4 AND p.workspace_payload IS NOT NULL AND 'products'=ANY($6::text[])
    UNION ALL
    SELECT $5::text,'inventory_logs'::text,l.id::text,jsonb_build_object('id',l.id,'productId',COALESCE(p.workspace_payload->>'id',l.inventory_item_id::text),'productName',COALESCE(p.name,'Inventory'),'type',CASE WHEN l.quantity_delta<0 THEN 'OUT' ELSE 'IN' END,'quantity',abs(l.quantity_delta),'previousStock',l.running-l.quantity_delta,'newStock',l.running,'reason',COALESCE(l.reason,l.reference_type),'timestamp',l.created_at,'user',l.actor_ref,'businessSector',$9::text,'moduleId',$4::text,'outletId',$3::text,'branchId',$3::text,'businessId',$8::text),1::bigint,false
    FROM(SELECT * FROM(SELECT t.*,sum(quantity_delta) OVER(PARTITION BY inventory_item_id,location_id ORDER BY created_at,id) AS running FROM pos.inventory_transactions t WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4) history ORDER BY created_at DESC,id DESC LIMIT 2000) l LEFT JOIN pos.products p ON p.inventory_item_id=l.inventory_item_id AND p.tenant_id=$1 AND p.merchant_id=$2 AND p.module_id=$4 WHERE 'inventory_logs'=ANY($6::text[])
   ) snapshot WHERE kind||chr(1)||record_id>$7 ORDER BY kind,record_id LIMIT 1001`,[scope.tenantId,scope.merchantId,scope.outletId,scope.moduleId,scope.namespace,kinds,cursor,scope.transportRef,scope.sector])).rows;
   const version=(await c.query(`SELECT md5(COALESCE((SELECT string_agg(kind||record_id||revision::text||deleted::text,'|' ORDER BY kind,record_id) FROM pos.shared_state_records WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4 AND kind=ANY($5::text[])),'')||COALESCE((SELECT string_agg(id::text||workspace_revision::text,'|' ORDER BY id) FROM pos.products WHERE tenant_id=$1 AND merchant_id=$2 AND module_id=$4),'')||COALESCE((SELECT string_agg(id::text||current_stock::text,'|' ORDER BY id) FROM pos.inventory_balances WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND module_id=$4),'')) AS version`,[scope.tenantId,scope.merchantId,scope.outletId,scope.moduleId,kinds])).rows[0].version;
   const more=rows.length>1000;if(more)rows.pop();

   if(!cursor&&kinds.includes('users')){const user=(await c.query('SELECT id,full_name FROM internal.users WHERE id::text=$1 AND is_active',[principal.subject])).rows[0];if(user)rows.push({scope:scope.namespace,kind:'users',record_id:user.id,value:{id:user.id,name:user.full_name,role:['OWNER','ADMIN'].includes(scope.role)?'ADMIN':scope.role,pin:'',status:'ACTIVE'},revision:1,deleted:false});}
   if(!cursor&&kinds.includes('staff_members')){const roster=(await c.query(`SELECT DISTINCT u.id,u.full_name,ms.role FROM internal.memberships ms JOIN internal.users u ON u.id=ms.user_id WHERE ms.tenant_id=$1 AND ms.is_active AND u.is_active AND (ms.scope_type='TENANT' OR ms.merchant_id=$2 AND(ms.scope_type='MERCHANT' OR ms.outlet_id=$3)) ORDER BY u.full_name,u.id`,[scope.tenantId,scope.merchantId,scope.outletId])).rows;for(const user of roster)rows.push({scope:scope.namespace,kind:'staff_members',record_id:user.id,value:{id:user.id,name:user.full_name,role:user.role,businessId:scope.transportRef,status:'ACTIVE'},revision:1,deleted:false});}
   return {ok:true,ready:true,scopeProof:true,kinds,business:{businessId:scope.merchantId,tenantId:scope.tenantId,sector:scope.sector},workspace:{outletId:scope.outletId,moduleId:scope.moduleId},records:rows.map(r=>({scope:r.scope,kind:r.kind,recordId:r.record_id,value:r.value,revision:Number(r.revision),deleted:r.deleted})),version,nextCursor:more?rows[Math.min(999,rows.length-1)].kind+'\x01'+rows[Math.min(999,rows.length-1)].record_id:null};
  });res.setHeader('Cache-Control','no-store');return res.json(result);}catch(e){return errorResponse(res,e);}
 });
 app.post('/api/v1/sync/modules/state',async(req,res)=>{
  const principal=trustedPrincipal(req);if(!principal)return res.status(401).json({ok:false,error:'UNAUTHENTICATED'});
  const operations=validOperations(req.body?.operations,true);if(!operations)return res.status(400).json({ok:false,error:'INVALID_STATE_REQUEST'});
  try{const result=await db.tx(async c=>{
   const scope=await resolveWorkspaceScope(c,principal.subject,req.body);assertWorkspaceKinds(scope,operations.map(op=>op.kind),true);
   if(operations.some(op=>op.kind==='products')&&!['TENANT','MERCHANT'].includes(scope.membershipScope))throw new ModuleAccessError(403,'MODULE_CATALOG_MANAGER_REQUIRED');
   const versions:any[]=[],conflicts:any[]=[];
   for(const op of operations){
    if(op.kind==='products'&&op.baseRevision>0&&!(await c.query('SELECT id FROM pos.products WHERE tenant_id=$1 AND merchant_id=$2 AND module_id=$3 AND external_ref=$4 FOR UPDATE',[scope.tenantId,scope.merchantId,scope.moduleId,workspaceProductRef(scope.moduleId,op.recordId)])).rows.length){conflicts.push({kind:op.kind,recordId:op.recordId,error:'STATE_CONFLICT'});continue;}
    const rawValue=op.value as Record<string,unknown>|null;
    if(op.kind==='products'&&!op.deleted&&(rawValue?.linkedStockItemId||Array.isArray(rawValue?.recipeIngredients)&&rawValue.recipeIngredients.length))throw new ModuleAccessError(409,'WORKSPACE_RECIPE_NOT_VALIDATED');
    const value=op.deleted?null:{...rawValue,tenantId:scope.tenantId,moduleId:scope.moduleId,outletId:scope.outletId,branchId:scope.outletId,businessId:scope.transportRef,businessSector:scope.sector};
    if(!op.deleted&&(['moduleId','outletId','branchId','businessId','tenantId'] as const).some(field=>rawValue?.[field]!==undefined&&rawValue[field]!==value![field]))throw new ModuleAccessError(403,'WORKSPACE_PAYLOAD_MISMATCH');
    const saved=await c.query(`INSERT INTO pos.shared_state_records(tenant_id,merchant_id,outlet_id,module_id,scope,kind,record_id,value,revision,deleted) SELECT $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8::jsonb,1,$9::boolean WHERE $10::bigint=0 OR $6='products' OR EXISTS(SELECT 1 FROM pos.shared_state_records WHERE tenant_id=$1 AND scope=$5 AND kind=$6 AND record_id=$7 AND revision=$10) ON CONFLICT(tenant_id,scope,kind,record_id) DO UPDATE SET value=excluded.value,deleted=excluded.deleted,revision=CASE WHEN(pos.shared_state_records.value,pos.shared_state_records.deleted) IS DISTINCT FROM(excluded.value,excluded.deleted) THEN pos.shared_state_records.revision+1 ELSE pos.shared_state_records.revision END,updated_at=CASE WHEN(pos.shared_state_records.value,pos.shared_state_records.deleted) IS DISTINCT FROM(excluded.value,excluded.deleted) THEN now() ELSE pos.shared_state_records.updated_at END WHERE pos.shared_state_records.revision=$10 OR excluded.kind='products' RETURNING revision`,[scope.tenantId,scope.merchantId,scope.outletId,scope.moduleId,scope.namespace,op.kind,op.recordId,value,op.deleted,op.baseRevision]);
    let revision=saved.rows[0]?.revision;
    if(!revision){revision=(await c.query(`SELECT revision FROM pos.shared_state_records WHERE tenant_id=$1 AND scope=$2 AND kind=$3 AND record_id=$4 AND value IS NOT DISTINCT FROM $5::jsonb AND deleted=$6`,[scope.tenantId,scope.namespace,op.kind,op.recordId,value,op.deleted])).rows[0]?.revision;}
    if(!revision){conflicts.push({kind:op.kind,recordId:op.recordId,error:'STATE_CONFLICT'});continue;}
    if(op.kind==='products'){
     if(op.deleted)await c.query('UPDATE pos.products SET is_available=false WHERE tenant_id=$1 AND merchant_id=$2 AND module_id=$3 AND external_ref=$4',[scope.tenantId,scope.merchantId,scope.moduleId,workspaceProductRef(scope.moduleId,op.recordId)]);
     else{const p=rawValue!;const projection=await c.query(`INSERT INTO pos.products(id,tenant_id,merchant_id,outlet_id,module_id,external_ref,name,sku,price,cost_price,is_available,business_sector,business_id,unit,workspace_payload) VALUES(uuidv7(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$15::jsonb) ON CONFLICT(tenant_id,merchant_id,external_ref) WHERE external_ref IS NOT NULL AND NOT sync_quarantined DO UPDATE SET name=excluded.name,sku=excluded.sku,price=excluded.price,cost_price=excluded.cost_price,is_available=excluded.is_available,workspace_payload=excluded.workspace_payload,workspace_revision=CASE WHEN(pos.products.name,pos.products.sku,pos.products.price,pos.products.cost_price,pos.products.is_available) IS DISTINCT FROM(excluded.name,excluded.sku,excluded.price,excluded.cost_price,excluded.is_available) THEN pos.products.workspace_revision+1 ELSE pos.products.workspace_revision END WHERE pos.products.module_id=excluded.module_id AND(pos.products.workspace_revision=$14::bigint OR (pos.products.name,pos.products.sku,pos.products.price,pos.products.cost_price,pos.products.is_available) IS NOT DISTINCT FROM(excluded.name,excluded.sku,excluded.price,excluded.cost_price,excluded.is_available)) RETURNING id,workspace_revision`,[scope.tenantId,scope.merchantId,scope.outletId,scope.moduleId,workspaceProductRef(scope.moduleId,op.recordId),p.name,String(p.sku||op.recordId).slice(0,50),p.price,p.costPrice,p.isAvailable!==false,scope.sector,scope.transportRef,String(p.unit||'pcs').slice(0,20),Number.isSafeInteger(p.catalogRevision)?p.catalogRevision:null,JSON.stringify(p)]);if(!projection.rows.length)throw new ModuleAccessError(409,'CATALOG_REVISION_CONFLICT');revision=projection.rows[0].workspace_revision;await attachWorkspaceInventory(c,scope,projection.rows[0].id,p.inventoryTracked===true||scope.moduleId==='retail');}
    }
    versions.push({kind:op.kind,recordId:op.recordId,revision:Number(revision)});
   }
   return {ok:true,versions,conflicts,rejected:[]};
  });res.setHeader('Cache-Control','no-store');return res.json(result);}catch(e){return errorResponse(res,e);}
 });
}
