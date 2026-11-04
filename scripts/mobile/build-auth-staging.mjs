// Public configuration only. No auth/session/provider credentials or SSO bypass.
// Explicit entry point: normal foundation builds remain unconfigured.
import fs from 'node:fs';
import {stagingConfig} from './auth-staging-config.mjs';
import {spawnSync} from 'node:child_process';
const profile=process.argv[2]||'pr29';
const config=stagingConfig(profile);
const env={...process.env,...config,AUTH_PROVIDER:'neon',VITE_MODULE_WORKSPACES:'0',NEW_HOPE_MODULE_WORKSPACES:'0'};
for(const [command,args] of [['npm',['run','native:sync']],['node',['scripts/mobile/check-neon-auth-bundle.mjs','dist-mobile']]]){
 const result=spawnSync(command,args,{env,stdio:'inherit'});
 if(result.status!==0)process.exit(result.status||1);
}
fs.mkdirSync('build/native-auth-acceptance',{recursive:true});
fs.writeFileSync('build/native-auth-acceptance/artifact-config.json',JSON.stringify({profile,provider:'neon',apiOrigin:config.VITE_NATIVE_API_ORIGIN,issuer:config.VITE_NEWHOPE_AUTH_URL,moduleFlags:'OFF',nativeCheckout:'OFF',providerLogin:'NOT RUN',nativeReachability:profile==='pr30'?'BLOCKED: protected Preview; public API approval required':'Requires live boundary verification'},null,2)+'\n');
console.log('PASS '+profile+' configured asset build; provider/device login NOT RUN'+(profile==='pr30'?'; native API blocked by Preview SSO':''));
