import type {Db} from '../shared/db';
import {tenantForPrincipal} from '../shared/auth';

export class BusinessScopeError extends Error {
  constructor(readonly status:number,message:string){super(message);}
}

/** Canonical UUID selection is authoritative. Legacy sector-only clients may
 * resolve an exact owner_sector alias, or an unambiguous single business only.
 * Never choose the first same-sector merchant based on creation/sort order.
 */
export async function resolveBusinessScope(db:Db,subject:string,sector:string,businessId?:unknown){
  if(businessId!==undefined&&(typeof businessId!=='string'||!businessId||businessId.length>128))
    throw new BusinessScopeError(400,'INVALID_BUSINESS_ID');
  const tenantId=await tenantForPrincipal(db,{subject});
  if(!tenantId){if(businessId!==undefined)throw new BusinessScopeError(403,'BUSINESS_ACCESS_DENIED');return null;}
  const result=await db.query(`SELECT m.id AS merchant_id,m.name AS business_name,m.external_ref
    FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
    WHERE t.id=$1 AND t.owner_user_ref=$2 AND t.is_active AND t.merged_into IS NULL
      AND m.business_sector=$3 AND m.is_active
      AND ($4::text IS NULL OR m.id::text=$4 OR m.external_ref=$4)
    ORDER BY m.id`,[tenantId,subject,sector,businessId??null]);
  const rows=result.rows;
  if(businessId!==undefined&&rows.length!==1)throw new BusinessScopeError(403,'BUSINESS_ACCESS_DENIED');
  const aliases=rows.filter(row=>row.external_ref===`${subject}_${sector}`);
  const selected=businessId!==undefined?rows[0]:aliases.length===1?aliases[0]:rows.length===1?rows[0]:null;
  if(!selected){if(rows.length)throw new BusinessScopeError(409,'BUSINESS_SELECTION_REQUIRED');return null;}
  return {tenantId,merchantId:selected.merchant_id as string,businessName:selected.business_name as string,
    transportRef:(selected.external_ref || selected.merchant_id) as string,
    legacyAlias:selected.external_ref===`${subject}_${sector}`?selected.external_ref as string:null};
}
