import type {Db} from '../shared/db';
import {moduleManifest} from '../../src/platform/modules/registry';
import {isBusinessModuleId,type BusinessModuleId} from '../../src/platform/modules/contracts';
import {resolveModuleAccess,ModuleAccessError} from './modules';
export interface WorkspaceScope{tenantId:string;merchantId:string;outletId:string;moduleId:BusinessModuleId;sector:string;actorRef:string;role:string;membershipScope:string;transportRef:string;namespace:string;permissions:string[];features:string[]}
/** Only verified identity/assignment rows establish ownership. Caller owns a transaction. */
export async function resolveWorkspaceScope(db:Db,subject:string,input:Record<string,unknown>,required:readonly string[]=[]):Promise<WorkspaceScope>{
 if(!isBusinessModuleId(input.moduleId))throw new ModuleAccessError(400,'EXPLICIT_MODULE_REQUIRED');
 const access=await resolveModuleAccess(db,subject,input.businessId,input.outletId);
 const grant=access.modules.find(m=>m.id===input.moduleId);
 if(!access.enabled||!grant||grant.workspaceVersion!==2)throw new ModuleAccessError(403,'ISOLATED_WORKSPACE_REQUIRED');
 if(required.some(permission=>!grant.permissions.includes(permission)||!grant.features.includes(permission)))throw new ModuleAccessError(403,'WORKSPACE_PERMISSION_DENIED');
 const row=(await db.query(`SELECT m.tenant_id,m.external_ref,CASE WHEN t.owner_user_ref=$2 THEN 'OWNER' ELSE ms.role END AS role,CASE WHEN t.owner_user_ref=$2 THEN 'TENANT' ELSE ms.scope_type END AS membership_scope
 FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id LEFT JOIN LATERAL(
 SELECT role,scope_type FROM internal.memberships WHERE user_id::text=$2 AND tenant_id=m.tenant_id AND is_active AND
 (scope_type='TENANT' OR merchant_id=m.id AND (scope_type='MERCHANT' OR outlet_id=$3))
 ORDER BY CASE role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'MANAGER' THEN 2 WHEN 'CASHIER' THEN 3 ELSE 4 END LIMIT 1
 ) ms ON true WHERE m.id=$1`,[access.businessId,subject,access.outletId])).rows[0];
 if(!row?.role)throw new ModuleAccessError(403,'WORKSPACE_MEMBERSHIP_REQUIRED');
 await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true),set_config('app.outlet_id',$3,true),set_config('app.module_id',$4,true),set_config('app.actor_ref',$5,true)",[row.tenant_id,access.businessId,access.outletId,input.moduleId,subject]);
 return {tenantId:row.tenant_id,merchantId:access.businessId,outletId:access.outletId,moduleId:input.moduleId,sector:moduleManifest(input.moduleId)!.sector,actorRef:subject,role:row.role,membershipScope:row.membership_scope,transportRef:row.external_ref||access.businessId,namespace:`WORKSPACE:${access.businessId}:${access.outletId}:${input.moduleId}`,permissions:grant.permissions,features:grant.features};
}
export function requireWorkspaceRole(scope:WorkspaceScope,roles:readonly string[]){if(!roles.includes(scope.role))throw new ModuleAccessError(403,'WORKSPACE_ROLE_FORBIDDEN');}
