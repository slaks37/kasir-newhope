import type {ModuleAccess} from '../../platform/modules/contracts';
const key=(actor:string,businessId:string,outletId:string)=>`newhope_module_lease_v1_${actor}_${businessId}_${outletId}`;
/** Offline UI lease only. Every server command independently checks current membership/entitlement. */
export function saveModuleLease(actor:string,access:ModuleAccess,now=Date.now()){
 const grants=access.modules.filter(m=>m.workspaceVersion===2);
 if(!access.enabled||!grants.length)return;
 const expiresAt=Math.min(now+86400000,...grants.map(m=>Date.parse(m.expiresAt||'')));
 if(!Number.isFinite(expiresAt)||expiresAt<=now)return;
 localStorage.setItem(key(actor,access.businessId,access.outletId),JSON.stringify({actor,verifiedAt:now,expiresAt,access}));
}
export function readModuleLease(actor:string,businessId:string,outletId:string,bootstrapExpiry:number|undefined,now=Date.now()):ModuleAccess|null{
 if(!bootstrapExpiry||bootstrapExpiry<=now)return null;
 try{const row=JSON.parse(localStorage.getItem(key(actor,businessId,outletId))||'null');if(!row||row.actor!==actor||row.verifiedAt>now||now>=row.expiresAt||row.expiresAt>row.verifiedAt+86400000||row.access?.businessId!==businessId||row.access?.outletId!==outletId||!row.access.enabled||!Array.isArray(row.access.modules)||row.access.modules.some((m:any)=>m.workspaceVersion!==2||!Array.isArray(m.permissions)||!Array.isArray(m.features)||!Number.isFinite(Date.parse(m.expiresAt))||Date.parse(m.expiresAt)<=now))return null;return {...row.access,offlineExpiresAt:Math.min(row.expiresAt,bootstrapExpiry)};}catch{return null;}
}
export function revokeModuleLease(actor:string,businessId:string,outletId:string){localStorage.removeItem(key(actor,businessId,outletId));}
