// Public configuration only. No auth/session/provider credentials or SSO bypass.
// Explicit entry point: normal foundation builds remain unconfigured.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(fs.readFileSync('mobile/auth-staging.public.json','utf8'));
assert.deepEqual(Object.keys(config).sort(),['VITE_AUTH_PROVIDER','VITE_NATIVE_API_ORIGIN','VITE_NEWHOPE_AUTH_URL','VITE_NEWHOPE_OFFLINE_PUBLIC_KEY'].sort());
assert.equal(config.VITE_AUTH_PROVIDER,'neon');
assert.equal(config.VITE_NATIVE_API_ORIGIN,'https://auth-staging.newhope.space');
assert.equal(config.VITE_NEWHOPE_AUTH_URL,'https://kasir-newhope-git-codex-neon-auth-cros-312050-slaks37s-projects.vercel.app/api/auth');
const jwk=JSON.parse(config.VITE_NEWHOPE_OFFLINE_PUBLIC_KEY);
assert.deepEqual(Object.keys(jwk).sort(),['crv','kid','kty','x','y'].sort());
assert.equal(jwk.kty,'EC');assert.equal(jwk.crv,'P-256');
const env={...process.env,...config,VITE_MODULE_WORKSPACES:'0',NEW_HOPE_MODULE_WORKSPACES:'0'};
for(const [command,args] of [['npm',['run','native:sync']],['node',['scripts/mobile/check-neon-auth-bundle.mjs','dist-mobile']]]){
 const result=spawnSync(command,args,{env,stdio:'inherit'});
 if(result.status!==0)process.exit(result.status||1);
}
console.log('PASS staging-only native assets: approved public API, canonical issuer, public offline key, module flags disabled; provider/device acceptance still required');
