import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import type {Db} from '../../services/shared/db';
import {resetSchemaFeatureCache} from '../../services/shared/schemaFeatures';
import {createSyncHandler} from '../../src/server/syncHandler';

/** Exercise the same POS HTTP route before and after the narrow grant. */
export async function ownerOnboardingAcceptance(admin:Db,pos:Db,installGuard:()=>Promise<void>){
  const subjects={
    owner:randomUUID(),unverified:randomUUID(),staffOnly:randomUUID(),
    assigned:randomUUID(),revoked:randomUUID(),otherOwner:randomUUID(),aliasConflict:randomUUID(),
  };
  for(const [role,subject] of Object.entries(subjects)){
    await admin.query('INSERT INTO internal.users(id,email,full_name,auth_staff_only) VALUES($1,$2,$3,$4)',
      [subject,subject+'@fixture.invalid','Onboarding fixture',role==='staffOnly']);
  }
  const otherTenant=randomUUID(),staffOnlyTenant=randomUUID();
  await admin.query(`INSERT INTO internal.tenants(id,name,owner_user_ref,external_ref)
    VALUES($1,'Existing tenant',$2,$3),($4,'Staff-only identity tenant',$5,NULL)`,
    [otherTenant,subjects.otherOwner,subjects.aliasConflict,staffOnlyTenant,subjects.staffOnly]);
  await admin.query(`INSERT INTO internal.memberships(user_id,tenant_id,scope_type,role,is_active,auth_managed)
    VALUES($1,$3,'TENANT','STAFF',true,false),($2,$3,'TENANT','STAFF',false,true)`,[subjects.assigned,subjects.revoked,otherTenant]);

  const app=express();
  app.use(express.json());
  app.use(createSyncHandler(async req=>{
    const role=String(req.headers.authorization||'').replace('Bearer ','') as keyof typeof subjects;
    const subject=Object.hasOwn(subjects,role)?subjects[role]:undefined;
    return subject?{subject,isEmailVerified:role!=='unverified'}:null;
  },async()=>pos));
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const address=server.address();
  assert(address&&typeof address==='object');
  const base='http://127.0.0.1:'+address.port+'/api/v1/sync/business';
  const request=async(role:keyof typeof subjects,tenantId?:string,body?:Record<string,unknown>)=>{
    const params=tenantId?'?workspace=2&tenantId='+tenantId:'?workspace=2';
    const response=await fetch(body?base:base+params,{method:body?'POST':'GET',
      headers:{authorization:'Bearer '+role,'content-type':'application/json','x-auth-email-verified':'true'},
      body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  };
  const payload={sector:'FNB',storeName:'First fixture business'};
  const expectDenied=async(role:keyof typeof subjects,status:number,error:string,body:Record<string,unknown>=payload)=>{
    assert.deepEqual(await request(role,undefined,body),{status,data:{ok:false,error}});
  };
  const previous=process.env.NEW_HOPE_MODULE_WORKSPACES;
  process.env.NEW_HOPE_MODULE_WORKSPACES='1';
  resetSchemaFeatureCache();
  try{
    const before=(await request('owner')).data;
    assert.equal(before.tenantId,null);
    assert.equal(before.canSetUpBusiness,false,'Missing migration fails closed for discovery');
    await expectDenied('owner',503,'OWNER_ONBOARDING_NOT_READY');
    await installGuard();
    resetSchemaFeatureCache();

    const fresh=await request('owner');
    assert.equal(fresh.status,200,JSON.stringify(fresh.data));
    assert.equal(fresh.data.tenantId,null);
    assert.equal(fresh.data.canSetUpBusiness,true);
    const untouched=await admin.query('SELECT id FROM internal.tenants WHERE owner_user_ref=$1',[subjects.owner]);
    assert.equal(untouched.rows.length,0,'Directory discovery creates no tenant');

    for(const role of ['staffOnly','assigned','revoked','unverified','aliasConflict'] as const){
      const directory=await request(role);
      assert.equal(directory.status,200,JSON.stringify(directory.data));
      assert.equal(directory.data.canSetUpBusiness,false);
    }
    for(const role of ['staffOnly','assigned','revoked'] as const)
      await expectDenied(role,403,'STAFF_WORKSPACE_SELECTION_REQUIRED');
    await expectDenied('unverified',403,'EMAIL_VERIFICATION_REQUIRED');
    await expectDenied('aliasConflict',409,'TENANT_OWNERSHIP_CONFLICT');
    assert.deepEqual((await admin.query('SELECT owner_user_ref,name FROM internal.tenants WHERE id=$1',[otherTenant])).rows,
      [{owner_user_ref:subjects.otherOwner,name:'Existing tenant'}]);
    await expectDenied('owner',403,'TENANT_OWNERSHIP_REQUIRED',{...payload,tenantId:otherTenant});
    await expectDenied('owner',400,'INVALID_TENANT_ID',{...payload,tenantId:'bad-id'});

    const created=await request('owner',undefined,payload);
    assert.equal(created.status,200,JSON.stringify(created.data));
    const {tenantId,merchantId}=created.data;
    assert(tenantId&&merchantId);
    assert.deepEqual(await request('owner',undefined,payload),created,'Lost ACK replay preserves tenant and business IDs');
    assert.deepEqual(await request('owner',undefined,{...payload,tenantId}),created);
    const ready=await request('owner',tenantId);
    assert.equal(ready.data.canSetUpBusiness,true);
    assert.equal(ready.data.subscription,null,'POS creates no subscription; billing owns initialization');
    assert.equal(ready.data.businesses.length,1);
    assert.equal(ready.data.businesses[0].businessId,merchantId);
    assert.deepEqual(ready.data.businesses[0].outlets,[]);
    assert.equal((await request('otherOwner',tenantId)).status,403);
    assert.equal((await admin.query('SELECT id FROM internal.tenants WHERE owner_user_ref=ANY($1::text[])',
      [[subjects.unverified,subjects.assigned,subjects.revoked,subjects.aliasConflict]])).rows.length,0);
    return {migrationMissingFailsClosed:'PASS',directoryReadOnly:'PASS',staffCannotProvision:'PASS',
      verifiedOwnerRequired:'PASS',exactTenantOwnership:'PASS',lostAckRetry:'PASS',outletRemainsExplicit:'PASS'};
  }finally{
    if(previous===undefined)delete process.env.NEW_HOPE_MODULE_WORKSPACES;
    else process.env.NEW_HOPE_MODULE_WORKSPACES=previous;
    resetSchemaFeatureCache();
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
}
