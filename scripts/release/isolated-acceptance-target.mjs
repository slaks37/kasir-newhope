// Non-secret, reviewed temporary acceptance target; never a production selector.
export const isolatedAcceptanceTarget={
 projectId:'raspy-paper-14687954',branchId:'br-bold-flower-a12o0elg',
 host:'ep-orange-sunset-a11woa5d.ap-southeast-1.aws.neon.tech',
 database:'neondb',expiresAt:'2026-11-27T12:00:00Z',
};
export function validateIsolatedAcceptance(env,now=Date.now()){
 const t=isolatedAcceptanceTarget;
 if(env.VERCEL_ENV!=='preview'||env.APP_ENV!=='staging'||env.NEWHOPE_ISOLATED_DOMAIN_ACCEPTANCE!==t.branchId||now>=Date.parse(t.expiresAt)||env.NEW_HOPE_MODULE_WORKSPACES!=='1'||env.VITE_MODULE_WORKSPACES!=='1'||env.NEW_HOPE_MODULE_DOMAIN_WORKFLOWS!=='1'||env.DOKU_PAYMENTS_ENABLED!=='0')throw Error('ISOLATED_ACCEPTANCE_CONFIGURATION_REQUIRED');
 for(const [name,role] of [['DATABASE_URL','newhope_pr35_qa_app'],['BETTER_AUTH_DATABASE_URL','newhope_pr35_qa_auth']]){
  let url;try{url=new URL(env[name]);}catch{throw Error('ISOLATED_ACCEPTANCE_DATABASE_REQUIRED');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname.replace('-pooler.','.')!==t.host||url.pathname!=='/'+t.database||decodeURIComponent(url.username)!==role)throw Error('ISOLATED_ACCEPTANCE_DATABASE_MISMATCH');
 }
 return true;
}
