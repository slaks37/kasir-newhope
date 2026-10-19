import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {verifyNeonToken,bindNeonIdentity} from '../../services/shared/neonAuth';
import type {Db} from '../../services/shared/db';
import {neonPilotConfig} from '../../services/shared/neonPilot';
import {databaseTransport} from '../../services/shared/databaseTls';
import {adminSecurityError} from '../../src/server/adminSecurity';

const env={NEON_MIGRATION_PILOT:'1',NEON_AUTH_BASE_URL:'https://ep-test.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth'};
const config=neonPilotConfig(env),now=Math.floor(Date.now()/1000);
const {publicKey,privateKey}=await generateKeyPair('EdDSA');
const key=createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'fixture'}]});
const subject='019a1234-1234-7123-8123-012345678901';
const token=async(overrides:Record<string,unknown>={})=>new SignJWT({sub:subject,id:subject,email:'fixture@example.invalid',emailVerified:true,
  iss:config.issuer,aud:config.issuer,iat:now,exp:now+300,...overrides}).setProtectedHeader({alg:'EdDSA',kid:'fixture'}).sign(privateKey);
const principal=await verifyNeonToken(await token({role:'SUPERADMIN',aal:'aal2',amr:[{method:'totp',timestamp:now}]}),config,key);
assert(principal);assert.equal(principal.aal,'aal1');assert.equal(principal.mfaVerifiedAt,undefined);
assert.equal(adminSecurityError(principal,'POST'),'MFA_REQUIRED','A claimed Neon MFA cannot bypass admin protection');
for(const overrides of [{emailVerified:false},{banned:true},{iss:'https://foreign.invalid'},{aud:'https://foreign.invalid'},
  {exp:now-60},{iat:now-1800,exp:now+60},{id:'other'},{sub:''}])assert.equal(await verifyNeonToken(await token(overrides),config,key),null,JSON.stringify(overrides));
assert.equal(await verifyNeonToken('not-a-token',config,key),null);
const mockDb=(binding:any,collision=false):Db=>{
  const db:Db={close:async()=>{},exec:async()=>{},tx:async fn=>fn(db),query:async sql=>{
    let rows:any[]=[];
    if(sql.includes('FROM neon_auth.'))rows=[{id:subject,email:'fixture@example.invalid',emailVerified:true,banned:false}];
    else if(sql.includes('FROM internal.auth_identity_bindings'))rows=binding?[binding]:[];
    else if(sql.includes('SELECT 1 FROM internal.users'))rows=collision?[{exists:true}]:[];
    else if(sql.includes('INSERT'))throw Error('Denied identity must never insert a user or binding');
    return {rows:rows as any,rowCount:rows.length};
  }};
  return db;
};
assert.equal(await bindNeonIdentity(mockDb(null,true),principal,config.issuer),null,'Matching email cannot claim an imported account');
assert.equal(await bindNeonIdentity(mockDb({canonical_user_id:subject,is_active:false,canonical_active:true}),principal,config.issuer),null);
assert.equal(await bindNeonIdentity(mockDb({canonical_user_id:subject,is_active:true,canonical_active:false}),principal,config.issuer),null);
const canonical='019a1234-1234-7123-8123-012345678999';
assert.equal((await bindNeonIdentity(mockDb({canonical_user_id:canonical,is_active:true,canonical_active:true}),principal,config.issuer))?.subject,canonical);
for(const extra of [{NEON_MIGRATION_PILOT:'0'},{VERCEL_ENV:'production'},{NODE_ENV:'production'},
  {NEON_AUTH_JWKS_URL:'https://another.invalid/jwks'},{NEON_AUTH_BASE_URL:'http://ep-test.neon.tech/auth'},
  {NEON_AUTH_BASE_URL:'https://ep-test.neon.tech.evil.invalid/auth'}])assert.throws(()=>neonPilotConfig({...env,...extra}));
assert.doesNotThrow(()=>neonPilotConfig({...env,NODE_ENV:'production',VERCEL_ENV:'preview'}));
const safe=databaseTransport('postgresql://test:fixture@ep-test-pooler.c-3.ap-southeast-1.aws.neon.tech/db?sslmode=disable');
assert.equal(safe.ssl?.rejectUnauthorized,true);assert(!safe.connectionString.includes('sslmode'));
assert.equal(databaseTransport('postgresql://test@127.0.0.1:5432/db').ssl,undefined);
console.log('PASS: Neon JWT negatives, fake MFA denied, production cutover blocked, branch JWKS binding and verified TLS enforced');
