import {isolatedAcceptanceTarget as acceptanceTarget,validateIsolatedAcceptance} from './isolated-acceptance-target.mjs';
import {stagingConfig,validateStagingConfig} from '../mobile/auth-staging-config.mjs';
import {selectedNeonPreview} from './select-api-artifact.mjs';
import {validateProviderAgreement} from './provider-agreement.mjs';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const outfile='build/neon-backend-probe.mjs';
await build({stdin:{contents:`export {authProvider} from './services/shared/betterAuthConfig';
export {authenticateBearer} from './services/shared/auth';
export {createAuthProviderOperations} from './services/shared/authProviderOperations';
export {createBlogMediaProvider} from './src/server/blogMedia';
export {serverlessConnectionString} from './services/shared/poolConfig';`,resolveDir:process.cwd()},outfile,bundle:true,platform:'node',format:'esm',packages:'external',minifySyntax:true,define:{'process.env.NEWHOPE_BUILD_TARGET':'"neon"'}});
for(const key of Object.keys(process.env))if(/SUPABASE|OBJECT_STORAGE|BETTER_AUTH|NEWHOPE_AUTH|^R2_/.test(key))delete process.env[key];
delete process.env.AUTH_PROVIDER;
let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('NETWORK_FORBIDDEN_IN_RELEASE_PROBE');};
const target=await import(pathToFileURL(path.resolve(outfile)).href);
assert.equal(target.authProvider(),'neon');
assert.throws(()=>target.authProvider({AUTH_PROVIDER:'supabase'}),/AUTH_PROVIDER_UNSUPPORTED/);
assert.throws(()=>target.createAuthProviderOperations({provider:'supabase'}),/AUTH_PROVIDER_UNSUPPORTED/);
assert.equal(target.createAuthProviderOperations().configured,false);
await assert.rejects(()=>target.authenticateBearer({headers:{authorization:'Bearer invalid'}}),/AUTH_UNAVAILABLE/);
await assert.rejects(()=>target.createBlogMediaProvider().upload(Buffer.from('test'),'invalid'),/BLOG_STORAGE_NOT_CONFIGURED/);
const oldUrl='postgresql://fixture:fixture@aws-0-region.pooler.supabase.com:5432/fixture';
assert.equal(target.serverlessConnectionString(oldUrl,'1'),oldUrl);
assert.equal(networkCalls,0,'No legacy/network fallback without Neon configuration');
console.log('PASS compiled Neon runtime: defaults to Neon, rejects legacy provider, no Auth/Storage network fallback, no legacy pool rewrite');

assert.equal(validateProviderAgreement({}),'supabase');
assert.equal(validateProviderAgreement({VITE_AUTH_PROVIDER:'neon'}),'neon');
assert.equal(validateProviderAgreement({VITE_AUTH_PROVIDER:'neon',AUTH_PROVIDER:'neon'}),'neon');
for(const env of [{AUTH_PROVIDER:'neon'},{VITE_AUTH_PROVIDER:'neon',AUTH_PROVIDER:'supabase'},{VITE_AUTH_PROVIDER:'other'},{AUTH_PROVIDER:'other'},{NEWHOPE_BUILD_TARGET:'neon'}])assert.throws(()=>validateProviderAgreement(env),/AUTH_PROVIDER_/);
assert.equal(validateProviderAgreement({VERCEL_ENV:'production',AUTH_PROVIDER:'supabase',VITE_AUTH_PROVIDER:'supabase'}),'supabase');
assert.throws(()=>validateProviderAgreement({VERCEL_ENV:'production',AUTH_PROVIDER:'neon',VITE_AUTH_PROVIDER:'neon'}),/AUTH_PRODUCTION_CUTOVER_DISABLED/);
console.log('PASS provider agreement: inconsistent or unsupported web/mobile/backend build intent rejected');

const preview={NEWHOPE_BUILD_TARGET:'neon',VERCEL_ENV:'preview',AUTH_PROVIDER:'neon',VITE_AUTH_PROVIDER:'neon',NEWHOPE_NEON_AUTH_STAGING:'1',NEW_HOPE_MODULE_WORKSPACES:'0',VITE_MODULE_WORKSPACES:'0'};
assert.equal(selectedNeonPreview({}),false);assert.equal(selectedNeonPreview(preview),true);
for(const override of [{VERCEL_ENV:'production'},{VERCEL_ENV:undefined},{AUTH_PROVIDER:'supabase'},{VITE_AUTH_PROVIDER:'supabase'},{NEWHOPE_NEON_AUTH_STAGING:'0'},{NEW_HOPE_MODULE_WORKSPACES:'1'},{VITE_MODULE_WORKSPACES:'1'}])assert.throws(()=>selectedNeonPreview({...preview,...override}));
console.log('PASS Neon artifact selection: explicit Preview only, provider agreement and both rollout flags OFF required');
const domainAcceptance={...preview,APP_ENV:'staging',NEWHOPE_ISOLATED_DOMAIN_ACCEPTANCE:acceptanceTarget.branchId,NEW_HOPE_MODULE_WORKSPACES:'1',VITE_MODULE_WORKSPACES:'1',NEW_HOPE_MODULE_DOMAIN_WORKFLOWS:'1',DOKU_PAYMENTS_ENABLED:'0',DATABASE_URL:'postgres://newhope_recovery_app:synthetic@'+acceptanceTarget.host+'/neondb',BETTER_AUTH_DATABASE_URL:'postgres://newhope_recovery_auth:synthetic@'+acceptanceTarget.host+'/neondb'};
assert.equal(validateIsolatedAcceptance(domainAcceptance,Date.parse('2026-11-05T00:00:00Z')),true);
for(const override of [{VERCEL_ENV:'production'},{APP_ENV:'production'},{DOKU_PAYMENTS_ENABLED:'1'},{NEWHOPE_ISOLATED_DOMAIN_ACCEPTANCE:'other-branch'},{NEW_HOPE_MODULE_DOMAIN_WORKFLOWS:'0'},{DATABASE_URL:'postgres://postgres:synthetic@production.invalid/neondb'},{BETTER_AUTH_DATABASE_URL:domainAcceptance.DATABASE_URL}])assert.throws(()=>validateIsolatedAcceptance({...domainAcceptance,...override},Date.parse('2026-11-05T00:00:00Z')));
assert.throws(()=>validateIsolatedAcceptance(domainAcceptance,Date.parse('2026-11-12T00:00:00Z')));
console.log('PASS isolated domain acceptance: exact reviewed branch/host/database/restricted roles, Preview/staging only, payments OFF and expiry; production always denied');


for(const profile of ['pr29','pr30']){
 const config=stagingConfig(profile);assert.equal(config.VITE_AUTH_PROVIDER,'neon');
 assert.throws(()=>validateStagingConfig(profile,{...config,VITE_NATIVE_API_ORIGIN:'https://foreign.invalid'}));
 assert.throws(()=>validateStagingConfig(profile,{...config,SECRET:'forbidden'}));
 const jwk=JSON.parse(config.VITE_NEWHOPE_OFFLINE_PUBLIC_KEY);
 assert.throws(()=>validateStagingConfig(profile,{...config,VITE_NEWHOPE_OFFLINE_PUBLIC_KEY:JSON.stringify({...jwk,d:'private-key-not-allowed'})}));
}
assert.throws(()=>validateStagingConfig('pr30',stagingConfig('pr29')));
assert.throws(()=>stagingConfig('unknown'));
console.log('PASS separate native staging profiles: wrong issuer/API, cross-environment config and private key fields rejected');
