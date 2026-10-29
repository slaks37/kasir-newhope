import assert from 'node:assert/strict';
import fs from 'node:fs';
const profiles={
 pr29:{file:'mobile/auth-staging.public.json',api:'https://auth-staging.newhope.space',issuer:'https://kasir-newhope-git-codex-neon-auth-cros-312050-slaks37s-projects.vercel.app'},
 pr30:{file:'mobile/auth-staff-staging.public.json',api:'https://kasir-newhope-git-codex-phase2-staff-o-518137-slaks37s-projects.vercel.app',issuer:'https://kasir-newhope-git-codex-phase2-staff-o-518137-slaks37s-projects.vercel.app'},
};
export function validateStagingConfig(profile,config){
 const expected=profiles[profile];assert(expected,'UNKNOWN_STAGING_PROFILE');
 assert.deepEqual(Object.keys(config).sort(),['VITE_AUTH_PROVIDER','VITE_NATIVE_API_ORIGIN','VITE_NEWHOPE_AUTH_URL','VITE_NEWHOPE_OFFLINE_PUBLIC_KEY'].sort());
 assert.equal(config.VITE_AUTH_PROVIDER,'neon');assert.equal(config.VITE_NATIVE_API_ORIGIN,expected.api);assert.equal(config.VITE_NEWHOPE_AUTH_URL,expected.issuer+'/api/auth');
 const jwk=JSON.parse(config.VITE_NEWHOPE_OFFLINE_PUBLIC_KEY);
 assert.deepEqual(Object.keys(jwk).sort(),['crv','kid','kty','x','y'].sort());assert.equal(jwk.kty,'EC');assert.equal(jwk.crv,'P-256');
 for(const field of ['x','y'])assert(/^[A-Za-z0-9_-]{43}$/.test(jwk[field]),'INVALID_PUBLIC_KEY');
 assert(typeof jwk.kid==='string'&&jwk.kid.length>0);
 return config;
}
export function stagingConfig(profile='pr29'){assert(profiles[profile],'UNKNOWN_STAGING_PROFILE');return validateStagingConfig(profile,JSON.parse(fs.readFileSync(profiles[profile].file,'utf8')));}
