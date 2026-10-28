import type {Db} from '../shared/db';
import {ModuleAccessError,moduleWorkspacesEnabled} from './modules';
import {hasSchemaFeature} from '../shared/schemaFeatures';
import {serializeSubscription} from '../billing/engine';
/** Membership-scoped read only bootstrap. Never provisions tenants or subscriptions for staff. */
export async function workspaceDirectory(db:Db,subject:string,requestedTenant:unknown){
 if(!moduleWorkspacesEnabled()||!await hasSchemaFeature(db,'workspaceIsolation'))throw new ModuleAccessError(403,'ISOLATED_WORKSPACE_REQUIRED');
 const managedStaff=await hasSchemaFeature(db,'staffAccounts');
 const tenants=(await db.query(`SELECT DISTINCT t.id,t.name FROM internal.tenants t WHERE t.is_active AND t.merged_into IS NULL AND (t.owner_user_ref=$1 OR EXISTS(SELECT 1 FROM internal.memberships ms JOIN internal.users u ON u.id=ms.user_id WHERE ms.tenant_id=t.id AND u.id::text=$1 AND u.is_active AND ms.is_active)) ORDER BY t.id`,[subject])).rows;
 const tenantId=typeof requestedTenant==='string'?tenants.find(t=>t.id===requestedTenant)?.id:tenants.length===1?tenants[0].id:null;
 if(requestedTenant&&!tenantId)throw new ModuleAccessError(403,'TENANT_MEMBERSHIP_REQUIRED');
 if(!tenantId)return {ok:true,tenantId:null,tenants:tenants.map(t=>({tenantId:t.id,name:t.name})),businesses:[],workspaceAuth:true};
 await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
 const result=await db.query(`SELECT ${managedStaff?'ms.id AS membership_id,ms.auth_managed,':''}t.owner_user_ref=$2 AS tenant_owner,m.id,m.tenant_id,m.name,m.business_sector,m.is_active,m.external_ref,o.id outlet_id,o.name outlet_name,o.address,o.is_active outlet_active,CASE WHEN t.owner_user_ref=$2 THEN 'OWNER' ELSE ms.role END role FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id JOIN internal.outlets o ON o.merchant_id=m.id AND o.tenant_id=t.id LEFT JOIN LATERAL(SELECT role${managedStaff?',ms.id,ms.auth_managed':''} FROM internal.memberships ms JOIN internal.users u ON u.id=ms.user_id WHERE ms.tenant_id=t.id AND ms.is_active AND u.is_active AND u.id::text=$2 AND(ms.scope_type='TENANT' OR ms.merchant_id=m.id AND(ms.scope_type='MERCHANT' OR ms.outlet_id=o.id)) ORDER BY CASE ms.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'MANAGER' THEN 2 WHEN 'CASHIER' THEN 3 ELSE 4 END LIMIT 1) ms ON true WHERE t.id=$1 AND(t.owner_user_ref=$2 OR ms.role IS NOT NULL) ORDER BY m.id,o.id`,[tenantId,subject]);
 const businesses=new Map<string,any>();
 for(const r of result.rows){
  if(r.auth_managed&&!r.tenant_owner){
   await db.query("SELECT set_config('app.merchant_id',$1,true)",[r.id]);
   const grants=await db.query('SELECT role FROM internal.staff_workspace_assignments WHERE membership_id=$1 AND tenant_id=$2 AND merchant_id=$3 AND outlet_id=$4',[r.membership_id,tenantId,r.id,r.outlet_id]);
   if(!grants.rows.length)continue;r.role=grants.rows[0].role;
  }
  let b=businesses.get(r.id);if(!b){b={businessId:r.id,tenantId,name:r.name,sector:r.business_sector,status:r.is_active?'ACTIVE':'INACTIVE',legacyAlias:r.external_ref===subject+'_'+r.business_sector?r.external_ref:null,transportRef:r.external_ref||r.id,outlets:[]};businesses.set(r.id,b);}b.outlets.push({outletId:r.outlet_id,businessId:r.id,name:r.outlet_name,address:r.address||'',status:r.outlet_active?'ACTIVE':'INACTIVE',role:r.role});}
 await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
 const subscription=(await db.query('SELECT * FROM contract.workspace_subscription_metadata WHERE tenant_id=$1',[tenantId])).rows[0];
 return {ok:true,tenantId,tenants:tenants.map(t=>({tenantId:t.id,name:t.name})),businesses:[...businesses.values()],workspaceAuth:true,capabilities:{multiBusiness:true},subscription:subscription?serializeSubscription(subscription):null};
}
