import {businessForOutlet,resolveLegacyBusiness,type BusinessIdentity} from './businessIdentity';
export type BusinessSelection={businessId:string;outletId?:string};
/** A saved preference is only a hint; the server directory proves membership. */
export function verifiedSelection(owner:string,tenantId:string,businesses:BusinessIdentity[],hint:BusinessSelection|null,legacy:{sector?:string;outletId?:string}={}):BusinessSelection|null{
  const active=businesses.filter(b=>b.tenantId===tenantId&&b.status==='ACTIVE'&&b.transportRef);
  let business=hint?active.find(b=>b.businessId===hint.businessId):undefined;
  if(hint&&!business)return null; // Revoked/inactive selection requires a new explicit choice.
  if(!business&&legacy.outletId)business=businessForOutlet(legacy.outletId,tenantId,active)||undefined;
  if(!business&&legacy.sector)business=resolveLegacyBusiness(owner+'_'+legacy.sector,tenantId,active)||undefined;
  if(!business&&active.length===1)business=active[0];
  if(!business)return null;
  const outlets=business.outlets.filter(o=>o.status==='ACTIVE');
  const outlet=outlets.find(o=>o.outletId===(hint?.businessId===business!.businessId?hint.outletId:legacy.outletId));
  return {businessId:business.businessId,outletId:outlet?.outletId||(outlets.length===1?outlets[0].outletId:undefined)};
}
export const selectionKey=(owner:string)=>'newhope_workspace_selection_v1_'+owner;
