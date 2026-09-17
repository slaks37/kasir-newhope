import type { Db } from '../shared/db';
import { isFreePlan, validateFreeSelection, type FreeSelection } from '../../src/config/freePlanPolicy';
export class FreePlanAccessError extends Error {}
/** Selection is validated before saving; choosing a branch never transfers stock. */
export async function validateFreeBranchSelection(db:Pick<Db,'query'>,ownerId:string,value:unknown) {
  const selection=validateFreeSelection(value);
  const {rows}=await db.query(`SELECT o.tenant_id FROM internal.outlets o
    JOIN internal.tenants t ON t.id=o.tenant_id
    JOIN internal.merchants m ON m.id=o.merchant_id AND m.tenant_id=o.tenant_id
    WHERE o.id::text=$1 AND t.owner_user_ref=$2 AND t.is_active AND o.is_active
      AND m.business_sector=$3`,[selection.branchId,ownerId,selection.sector]);
  if(!rows.length) throw new FreePlanAccessError('BRANCH_NOT_OWNED');
  const existing=await db.query(`SELECT p.external_ref FROM pos.products p
    JOIN internal.tenants t ON t.id=p.tenant_id WHERE t.owner_user_ref=$1
      AND p.external_ref=ANY($2::text[]) AND p.business_sector=$3
      AND (p.tenant_id<>$4::uuid OR p.outlet_id IS DISTINCT FROM $5::uuid)`,
    [ownerId,selection.productIds,selection.sector,rows[0].tenant_id,selection.branchId]);
  if(existing.rows.length) throw new FreePlanAccessError('FREE_PRODUCT_BRANCH_MISMATCH');
  return selection;
}
export async function freePlanState(db:Pick<Db,'query'>,tenantId:string):Promise<{free:boolean;selection?:FreeSelection;ownerId?:string}> {
  const {rows}=await db.query('SELECT * FROM contract.free_plan_entitlements WHERE tenant_id=$1',[tenantId]);
  const s=rows[0];
  if(!s || !s.is_active) return {free:false};
  const free=isFreePlan({status:s.status,planId:s.plan_id,currentPeriodEnd:new Date(s.current_period_end).toISOString()});
  return {free,ownerId:s.owner_user_ref,selection:free&&s.free_selection?validateFreeSelection(s.free_selection):undefined};
}
export function assertFreeScope(state:{free:boolean;selection?:FreeSelection},sector:string,productRefs:string[]) {
  if(!state.free) return;
  if(!state.selection || state.selection.sector!==sector) throw new FreePlanAccessError('FREE_SELECTION_REQUIRED');
  if(productRefs.some(id=>!state.selection!.productIds.includes(id))) throw new FreePlanAccessError('FREE_PRODUCT_LOCKED');
}

/** Resolve only the saved Free outlet; never create a tenant, merchant or outlet here. */
export async function resolveFreeSyncScope(db:Pick<Db,'query'>,ownerId:string,sector:string) {
  const {rows}=await db.query(`SELECT * FROM contract.free_plan_entitlements
    WHERE owner_user_ref=$1 ORDER BY tenant_id LIMIT 1`,[ownerId]);
  const entitlement=rows[0];
  if(!entitlement) return undefined;
  if(!entitlement.is_active) throw new FreePlanAccessError('TENANT_INACTIVE');
  if(!isFreePlan({status:entitlement.status,planId:entitlement.plan_id,currentPeriodEnd:new Date(entitlement.current_period_end).toISOString()})) return undefined;
  const selection=entitlement.free_selection ? validateFreeSelection(entitlement.free_selection) : undefined;
  assertFreeScope({free:true,selection},sector,[]);
  const result=await db.query(`SELECT o.tenant_id, o.merchant_id, o.id AS outlet_id
    FROM internal.outlets o JOIN internal.tenants t ON t.id=o.tenant_id
    JOIN internal.merchants m ON m.id=o.merchant_id AND m.tenant_id=o.tenant_id
    WHERE o.id::text=$1 AND t.owner_user_ref=$2 AND t.is_active
      AND o.is_active AND m.business_sector=$3`,[selection!.branchId,ownerId,sector]);
  if(!result.rows.length) throw new FreePlanAccessError('FREE_BRANCH_UNAVAILABLE');
  return result.rows[0] as {tenant_id:string;merchant_id:string;outlet_id:string};
}
