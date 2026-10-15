import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import {registerNeonOnboarding} from '../../services/pos/neonOnboarding';
import {registerBusinessDirectory} from '../../services/pos/businessDirectory';
import {readBusinessDirectory} from '../../src/lib/workspace/businessDirectory';
import {verifiedSelection} from '../../src/lib/workspace/selection';
import {pastikanPaket} from '../../services/billing/store';
import {SAAS_PLANS} from '../../src/config/saasPlans';
import type {Db} from '../../services/shared/db';

const pg=new PGlite();let server:any;
const makeDb=(runner:any):Db=>({query:async(sql,params)=>{const r=await runner.query(sql,params);return {rows:r.rows,rowCount:r.affectedRows??r.rows.length};},
  exec:sql=>runner.exec(sql),tx:fn=>pg.transaction(c=>fn(makeDb(c))),close:()=>pg.close()});
const db=makeDb(pg),owner=randomUUID(),issuer='https://fixture.neon.tech';
process.env.AUTH_PROVIDER='neon';process.env.NEON_MIGRATION_PILOT='1';process.env.NEON_AUTH_BASE_URL=issuer+'/auth';
try {
  const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f),'neon/migrations/0001_identity_bindings.sql'];
  for(const file of files)await pg.exec(fs.readFileSync(file,'utf8'));
  // Reproduce the source-shaped catalog whose multi-business namespace is absent.
  await pg.exec('ALTER TABLE pos.shared_state_records DROP CONSTRAINT IF EXISTS shared_state_business_namespace');
  await pastikanPaket(db,SAAS_PLANS);
  await pg.query('INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,$3)',[owner,'fixture@example.invalid','Synthetic owner']);
  await pg.query("INSERT INTO internal.auth_identity_bindings(provider,issuer,provider_subject,canonical_user_id,verification_ref) VALUES('neon',$1,$2::text,$2::uuid,'NEW_VERIFIED_ACCOUNT')",[issuer,owner]);
  const app=express();app.use(express.json());registerNeonOnboarding(app,db);registerBusinessDirectory(app,db);
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port,headers={'x-auth-sub':owner,'x-auth-email':'fixture@example.invalid','x-auth-email-verified':'true','content-type':'application/json'};
  const onboard=await fetch(base+'/api/v1/sync/neon-onboarding',{method:'POST',headers,body:JSON.stringify({business_sector:'FNB',store_name:'Synthetic store',external_ref:'attacker-controlled'})});
  assert.equal(onboard.status,200);assert.equal((await onboard.json()).created,true);
  const raw=await (await fetch(base+'/api/v1/sync/business',{headers})).json(),directory=readBusinessDirectory(raw);
  assert.equal(raw.capabilities.multiBusiness,false);
  assert.equal(directory.businesses[0].legacyAlias,owner+'_FNB');
  const eligible=directory.businesses.filter(b=>b.legacyAlias||directory.capabilities?.multiBusiness);
  assert.equal(verifiedSelection(owner,directory.tenantId!,eligible,null,{sector:'FNB'})?.businessId,directory.businesses[0].businessId);
  const id=directory.businesses[0].businessId;
  const replay=await fetch(base+'/api/v1/sync/neon-onboarding',{method:'POST',headers,body:'{}'});assert.equal((await replay.json()).created,false);
  await pg.query('UPDATE internal.merchants SET external_ref=NULL WHERE id=$1',[id]);
  const correction=fs.readFileSync('neon/migrations/0009_native_onboarding_transport.sql','utf8');
  await db.tx(c=>c.exec(correction));
  assert.equal((await pg.query<{external_ref:string}>('SELECT external_ref FROM internal.merchants WHERE id=$1',[id])).rows[0].external_ref,owner+'_FNB');
  await db.tx(c=>c.exec(correction));
  assert.equal((await pg.query('SELECT * FROM internal.merchants WHERE tenant_id=$1',[directory.tenantId])).rows.length,1);
  // An imported identity with the same missing alias must not be silently repaired.
  await pg.query("UPDATE internal.auth_identity_bindings SET verification_ref='REVIEWED_SOURCE_IMPORT' WHERE canonical_user_id=$1",[owner]);
  await pg.query('UPDATE internal.merchants SET external_ref=NULL WHERE id=$1',[id]);
  await db.tx(c=>c.exec(correction));
  assert.equal((await pg.query<{external_ref:string|null}>('SELECT external_ref FROM internal.merchants WHERE id=$1',[id])).rows[0].external_ref,null);
  await pg.query("UPDATE internal.auth_identity_bindings SET verification_ref='NEW_VERIFIED_ACCOUNT' WHERE canonical_user_id=$1",[owner]);
  const foreign=randomUUID();
  await pg.query("INSERT INTO internal.tenants(id,name) VALUES($1,'Synthetic conflicting tenant')",[foreign]);
  await pg.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$1,'Synthetic conflict','FNB',$2)",[foreign,owner+'_FNB']);
  await assert.rejects(db.tx(c=>c.exec(correction)),/NATIVE_ONBOARDING_TRANSPORT_CONFLICT/);
  assert.equal((await pg.query<{external_ref:string|null}>('SELECT external_ref FROM internal.merchants WHERE id=$1',[id])).rows[0].external_ref,null,'Conflicts must roll back, never choose another owner');
  assert.equal((await pg.query('SELECT * FROM pos.transactions')).rows.length,0);
  console.log('PASS: native onboarding → source-shaped catalog → UI business selection, untrusted alias ignored, replay, guarded idempotent repair and imported identity preservation');
} finally {if(server)await new Promise(resolve=>server.close(resolve));await pg.close();}
