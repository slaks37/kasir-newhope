import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {validateProviderAgreement} from './provider-agreement.mjs';
export function selectedNeonPreview(env){
 if(!env.NEWHOPE_BUILD_TARGET)return false;
 if(env.NEWHOPE_BUILD_TARGET!=='neon')throw Error('BACKEND_BUILD_TARGET_UNSUPPORTED');
 if(env.VERCEL_ENV!=='preview'||env.AUTH_PROVIDER!=='neon'||env.NEWHOPE_NEON_AUTH_STAGING!=='1')throw Error('NEON_ARTIFACT_PREVIEW_ONLY');
 validateProviderAgreement(env);
 if(env.NEW_HOPE_MODULE_WORKSPACES!=='0'||env.VITE_MODULE_WORKSPACES!=='0')throw Error('ROLLOUT_FLAGS_MUST_STAY_OFF');
 return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&selectedNeonPreview(process.env)){
 const result=spawnSync(process.execPath,['scripts/release/build-neon-backend.mjs'],{stdio:'inherit'});
 if(result.status!==0)process.exit(result.status||1);
 for(const file of await fs.readdir('build/neon-backend/api'))await fs.copyFile('build/neon-backend/api/'+file,'api/'+file);
 console.log('Selected audited Neon API artifact for isolated Preview; production selection prohibited');
}
