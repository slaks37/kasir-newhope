/** Release gates contain identifiers, never email ownership guesses or roles. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuidAllowlist(value:string|undefined):string[]{
 const ids=(value||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
 if(ids.some(id=>!UUID.test(id)))throw Error('RELEASE_ALLOWLIST_INVALID');
 return [...new Set(ids)];
}
export function betaAccessError(subject:string,env=process.env):string|undefined {
 if(!env.BETA_ACCESS_MODE || env.BETA_ACCESS_MODE==='open')return;
 if(env.BETA_ACCESS_MODE!=='invite_only')return 'BETA_CONFIGURATION_INVALID';
 try{return uuidAllowlist(env.BETA_ALLOWED_SUBJECTS).includes(subject.toLowerCase())?undefined:'BETA_INVITE_REQUIRED';}
 catch{return 'BETA_CONFIGURATION_INVALID';}
}
export function checkoutPilotAllowed(tenantId:string,env=process.env):boolean {
 try{return uuidAllowlist(env.DOKU_CHECKOUT_PILOT_TENANTS).includes(tenantId.toLowerCase());}catch{return false;}
}
