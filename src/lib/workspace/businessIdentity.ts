export interface BusinessIdentity {
  businessId:string;tenantId:string;name:string;sector:string;status:string;legacyAlias:string|null;
  transportRef?:string|null;
  outlets:Array<{outletId:string;businessId:string;name:string;address:string;status:string;latitude?:number|null;longitude?:number|null;radiusMeters?:number|null}>;
}
export function directoryOutletRows(businesses:BusinessIdentity[]){return businesses.flatMap(b=>b.outlets.map(o=>({id:o.outletId,merchant_id:b.businessId,name:o.name,address:o.address,
  business_sector:b.sector,is_active:b.status==='ACTIVE'&&o.status==='ACTIVE',latitude:o.latitude,longitude:o.longitude,radius_meters:o.radiusMeters})));}
/** Only a server-declared exact alias proves a legacy partition's destination.
 * Neither sector, name, sort order nor the current selection is mapping proof.
 * This function never writes/rekeys queues, source data or financial snapshots.
 */
export function resolveLegacyBusiness(legacyKey:string,tenantId:string,businesses:BusinessIdentity[]):BusinessIdentity|null{
  const matches=businesses.filter(b=>b.tenantId===tenantId&&b.legacyAlias===legacyKey);
  return matches.length===1?matches[0]:null;
}
export function businessForOutlet(outletId:string,tenantId:string,businesses:BusinessIdentity[]):BusinessIdentity|null{
  const matches=businesses.filter(b=>b.tenantId===tenantId&&b.outlets.some(o=>o.outletId===outletId&&o.businessId===b.businessId));
  return matches.length===1?matches[0]:null;
}
