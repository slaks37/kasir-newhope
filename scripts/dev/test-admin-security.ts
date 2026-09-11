import assert from 'node:assert/strict';
import type { Request } from 'express';
import { authenticateBearer } from '../../services/shared/auth';
import { adminSecurityError } from '../../src/server/adminSecurity';

async function main() {
  const originalFetch=globalThis.fetch;
  const keys=['SUPABASE_URL','SUPABASE_ANON_KEY','AUTH_ALLOW_LOCAL_DEVELOPMENT'];
  const saved=keys.map(k=>process.env[k]);
  const now=Math.floor(Date.now()/1000);
  let validToken='';
  const claims={sub:'verified-owner',exp:now+3600,aal:'aal2',amr:[{method:'totp',timestamp:now}]};
  const token=(value:any)=>Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(value)).toString('base64url')+'.test-signature';
  const request=(value:string)=>({headers:{authorization:'Bearer '+value,'x-aal':'aal2'}} as unknown as Request);
  try {
    process.env.SUPABASE_URL='https://auth.test.invalid';process.env.SUPABASE_ANON_KEY='test-anon';delete process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT;
    // Auth is an injected network boundary, not a local signature verifier.
    globalThis.fetch=async(input,init)=>{
      assert.equal(String(input),'https://auth.test.invalid/auth/v1/user');
      const authorized=new Headers(init?.headers).get('authorization')==='Bearer '+validToken;
      return new Response(JSON.stringify(authorized?{id:'verified-owner'}:{error:'invalid token'}),{status:authorized?200:401,headers:{'content-type':'application/json'}});
    };
    validToken=token(claims);
    const principal=await authenticateBearer(request(validToken));assert.ok(principal);assert.equal(principal.aal,'aal2');
    assert.equal(adminSecurityError(principal,'POST',now*1000),null);
    assert.equal(await authenticateBearer(request(token({...claims,sub:'attacker'}))),null);
    validToken=token({...claims,aal:'aal1',user_metadata:{aal:'aal2'}});
    const first=await authenticateBearer(request(validToken));assert.ok(first);assert.equal(adminSecurityError(first,'GET'),'MFA_REQUIRED');
    validToken=token({...claims,amr:[{method:'totp',timestamp:now-600},{method:'token_refresh',timestamp:now}]});
    const stale=await authenticateBearer(request(validToken));assert.ok(stale);assert.equal(adminSecurityError(stale,'POST',now*1000),'REAUTH_REQUIRED');assert.equal(adminSecurityError(stale,'GET'),null);
    validToken=token({...claims,amr:[{method:'totp',timestamp:now+120}]});
    const future=await authenticateBearer(request(validToken));assert.ok(future);assert.equal(adminSecurityError(future,'POST'),'REAUTH_REQUIRED');
    validToken=token({...claims,sub:'different-subject'});assert.equal(await authenticateBearer(request(validToken)),null);
    validToken=token({...claims,exp:now-1});assert.equal(await authenticateBearer(request(validToken)),null);
    validToken='malformed';assert.equal(await authenticateBearer(request(validToken)),null);
    console.log('PASS: Auth validation precedes claims; forged/expired/mismatched tokens denied; user_metadata and token refresh cannot satisfy MFA freshness');
  } finally {
    globalThis.fetch=originalFetch;
    keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];});
  }
}
main().catch(err=>{console.error(err);process.exitCode=1;});
