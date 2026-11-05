// Non-secret, reviewed temporary acceptance target; never a production selector.
export const isolatedAcceptanceTarget={
 projectId:'steep-sea-66546931',branchId:'br-red-smoke-aznyozaq',
 host:'ep-gentle-silence-az2bwpz6.c-3.ap-southeast-1.aws.neon.tech',
 database:'neondb',expiresAt:'2026-11-11T12:00:00Z',
};
export function validateIsolatedAcceptance(env,now=Date.now()){
 const t=isolatedAcceptanceTarget;
 if(env.VERCEL_ENV!=='preview'||env.APP_ENV!=='staging'||env.NEWHOPE_ISOLATED_DOMAIN_ACCEPTANCE!==t.branchId||now>=Date.parse(t.expiresAt)||env.NEW_HOPE_MODULE_WORKSPACES!=='1'||env.VITE_MODULE_WORKSPACES!=='1'||env.NEW_HOPE_MODULE_DOMAIN_WORKFLOWS!=='1'||env.DOKU_PAYMENTS_ENABLED!=='0')throw Error('ISOLATED_ACCEPTANCE_CONFIGURATION_REQUIRED');
 for(const [name,role] of [['DATABASE_URL','newhope_recovery_app'],['NEON_AUTH_DATABASE_URL','newhope_recovery_auth']]){
  let url;try{url=new URL(env[name]);}catch{throw Error('ISOLATED_ACCEPTANCE_DATABASE_REQUIRED');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname.replace('-pooler.','.')!==t.host||url.pathname!=='/'+t.database||decodeURIComponent(url.username)!==role)throw Error('ISOLATED_ACCEPTANCE_DATABASE_MISMATCH');
 }
 return true;
}
