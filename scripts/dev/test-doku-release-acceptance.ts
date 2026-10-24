import assert from 'node:assert/strict';import fs from 'node:fs';import {randomUUID} from 'node:crypto';
import type {Db} from '../../services/shared/db';
import {assertDokuReadiness,dokuCredentialFingerprint} from '../../services/billing/paymentReadiness';
export async function testDokuReleaseAcceptance(db:Db){
 const saved={...process.env};const tenant=randomUUID(),id=randomUUID();
 try{
  Object.assign(process.env,{DOKU_PAYMENTS_ENABLED:'1',DOKU_ACTIVATION_APPROVED:'1',DOKU_RELEASE_SCOPE:'pilot',DOKU_ACCEPTANCE_ID:id,DOKU_CHECKOUT_PILOT_TENANTS:tenant,DOKU_API_URL:'https://api.doku.com',DOKU_CLIENT_ID:'BRN-synthetic-only',DOKU_SECRET_KEY:'synthetic-release-key',DOKU_ALLOWED_CHANNELS:'QRIS',PUBLIC_APP_URL:'https://kasir.newhope.space',FULL_NEON_CLEAN_START:'1',FULL_NEON_TARGET:'production',VERCEL_ENV:'production',AUTH_PROVIDER:'neon'});
  await assert.rejects(()=>assertDokuReadiness(db,tenant),/ACCEPTANCE_REQUIRED/);
  await db.query(`INSERT INTO billing.doku_release_acceptances(id,scope,api_url,credential_sha256,channels,allowed_tenants,owner_approval_ref,provider_evidence_sha256,credentials_verified_at,webhook_verified_at,expires_at)
    VALUES($1,'PILOT','https://api.doku.com',$2,ARRAY['QRIS'],$3,'SYNTHETIC_APPROVAL_ONLY',$4,now(),now(),now()+interval '1 hour')`,[id,dokuCredentialFingerprint(),[tenant],'0'.repeat(64)]);
  assert.equal((await assertDokuReadiness(db,tenant)).scope,'PILOT');
  for(const field of ['credentials_verified_at','webhook_verified_at','live_payment_verified_at']){
   await db.query(`UPDATE billing.doku_release_acceptances SET ${field}=now()+interval '1 hour' WHERE id=$1`,[id]);
   await assert.rejects(()=>assertDokuReadiness(db,tenant),/ACCEPTANCE_REQUIRED/);
   await db.query(`UPDATE billing.doku_release_acceptances SET ${field}=${field==='live_payment_verified_at'?'NULL':'now()'} WHERE id=$1`,[id]);
  }
  for(const [key,value] of Object.entries({DOKU_ACTIVATION_APPROVED:'0',DOKU_SECRET_KEY:'changed',VERCEL_ENV:'preview',FULL_NEON_TARGET:'staging',AUTH_PROVIDER:'supabase',PUBLIC_APP_URL:'https://foreign.invalid',DOKU_API_URL:'https://api-sandbox.doku.com',DOKU_CHECKOUT_PILOT_TENANTS:'*',DOKU_RELEASE_SCOPE:'public',DOKU_ACCEPTANCE_ID:randomUUID()})){
   const before=process.env[key];process.env[key]=value;await assert.rejects(()=>assertDokuReadiness(db,tenant));process.env[key]=before;
  }
  await assert.rejects(()=>assertDokuReadiness(db,randomUUID()),/PILOT_ONLY/);
  await db.query('UPDATE billing.doku_release_acceptances SET credential_sha256=$2 WHERE id=$1',[id,'1'.repeat(64)]);await assert.rejects(()=>assertDokuReadiness(db,tenant),/ACCEPTANCE_REQUIRED/);
  await db.query('UPDATE billing.doku_release_acceptances SET credential_sha256=$2,revoked_at=now() WHERE id=$1',[id,dokuCredentialFingerprint()]);await assert.rejects(()=>assertDokuReadiness(db,tenant),/ACCEPTANCE_REQUIRED/);
  await assert.rejects(()=>db.query("UPDATE billing.doku_release_acceptances SET scope='PUBLIC' WHERE id=$1",[id]),/check constraint/);
  const exists=(await db.query("SELECT 1 FROM pg_roles WHERE rolname='newhope_clean_runtime'")).rowCount;
  if(!exists)await db.exec('CREATE ROLE newhope_clean_runtime NOLOGIN');
  await db.exec(fs.readFileSync('migrations/0064_doku_release_acceptance.sql','utf8'));
  await db.exec('GRANT USAGE ON SCHEMA billing TO newhope_clean_runtime');
  await db.tx(async c=>{await c.exec('SET LOCAL ROLE newhope_clean_runtime');assert((await c.query('SELECT id FROM billing.doku_release_acceptances')).rowCount>0);});
  for(const sql of ["DELETE FROM billing.doku_release_acceptances WHERE false","UPDATE billing.doku_release_acceptances SET revoked_at=now() WHERE false"])
   await assert.rejects(()=>db.tx(async c=>{await c.exec('SET LOCAL ROLE newhope_clean_runtime');await c.query(sql);}),/permission denied/);
  process.env.DOKU_PAYMENTS_ENABLED='0';let reads=0;await assert.rejects(()=>assertDokuReadiness({...db,query:async()=>{reads++;throw Error('NO_DATABASE_READ');}},tenant),/PAYMENTS_PAUSED/);assert.equal(reads,0);
  console.log('PASS durable DOKU release acceptance: environment isolation, exact credential/channel binding, pilot tenant approval, missing/revoked acceptance denial, PUBLIC requires live evidence, runtime read-only, OFF makes zero reads');
 }finally{for(const k of new Set([...Object.keys(saved),...Object.keys(process.env)])){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
}
