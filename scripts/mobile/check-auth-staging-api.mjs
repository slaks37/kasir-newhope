// Real public reachability/CORS/anonymous denial only. Does not claim login,
// membership, financial workflow or installed-device acceptance.
import assert from 'node:assert/strict';
const base='https://auth-staging.newhope.space';
const canonical='https://kasir-newhope-git-codex-neon-auth-cros-312050-slaks37s-projects.vercel.app';
const request=(url,options={})=>fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(20000)});
for(const origin of ['capacitor://localhost','https://localhost','https://foreign.fixture.invalid']){
 const allowed=origin!=='https://foreign.fixture.invalid';
 const response=await request(base+'/api/auth/identity',{method:'OPTIONS',headers:{origin,'access-control-request-method':'GET','access-control-request-headers':'authorization,x-newhope-offline-device'}});
 assert.equal(response.status,allowed?204:403);
 assert.equal(response.headers.get('access-control-allow-origin'),allowed?origin:null);
 assert.equal(response.headers.get('access-control-allow-credentials'),null,'Native bearer API does not share browser cookies');
 console.log('PASS staging CORS',origin,response.status);
}
for(const path of ['/api/auth/identity','/api/v1/subscription/status','/api/v1/reports/summary','/api/v1/finance/shift']){
 const response=await request(base+path);assert.equal(response.status,401);
 assert.match(response.headers.get('content-type')||'',/application\/json/);
 console.log('PASS staging anonymous denial',path);
}
const protectedPreview=await request(canonical+'/api/auth/identity');
assert.equal(protectedPreview.status,302);
assert.equal(new URL(protectedPreview.headers.get('location')).hostname,'vercel.com');
console.log('PASS original Preview SSO retained; no embedded bypass, secrets or authenticated-session claim');
