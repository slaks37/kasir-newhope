import assert from 'node:assert/strict';
import type {Db} from '../../services/shared/db';

export const legacyWorkspaceNamespace='supabase/migrations/20261003040610_business_scoped_operational_state.sql';
export const repairWorkspaceNamespace='migrations/0081_workspace_shared_state_namespace_repair.sql';

export async function workspaceNamespaceAcceptance(
  admin:Db,pos:Db,fixture:{tenant:string;merchant:string;outlet:string},apply:(file:string)=>Promise<void>,
){
  const {tenant,merchant,outlet}=fixture;
  const scope='WORKSPACE:'+merchant+':'+outlet+':retail';
  const valid={moduleId:'retail',outletId:outlet,businessSector:'RETAIL',storeMode:'RETAIL'};
  const scoped=<T>(fn:(c:Db)=>Promise<T>)=>pos.tx(async c=>{
    await c.query(`SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true),
      set_config('app.outlet_id',$3,true),set_config('app.module_id','retail',true)`,[tenant,merchant,outlet]);
    return fn(c);
  });
  const insert=(db:Db,value=valid)=>db.query(`INSERT INTO pos.shared_state_records
    (tenant_id,merchant_id,outlet_id,module_id,scope,kind,record_id,value)
    VALUES($1,$2,$3,'retail',$4,'store_settings','workspace-namespace-fixture',$5::jsonb)`,
    [tenant,merchant,outlet,scope,JSON.stringify(value)]);
  const legacyWrite=()=>scoped(c=>c.query(`INSERT INTO pos.shared_state_records
    (tenant_id,merchant_id,scope,kind,record_id,value)
    VALUES($1,$2,'FNB','store_settings','legacy-namespace-fixture','{"storeMode":"FNB"}')`,[tenant,merchant]));
  const snapshot=()=>admin.query(`SELECT to_jsonb(r) AS row FROM pos.shared_state_records r
    WHERE tenant_id=$1 ORDER BY scope,kind,record_id`,[tenant]);
  const versions=()=>admin.query(`SELECT to_jsonb(r) AS row FROM pos.shared_state_versions r
    WHERE tenant_id=$1 ORDER BY scope,kind`,[tenant]);

  await legacyWrite();
  await assert.rejects(()=>scoped(async c=>{
    await insert(c);
    throw Error('ROLLBACK_ORDER_PROBE');
  }),/ROLLBACK_ORDER_PROBE/,'0067 must enable v2 after the shared bootstrap order, even before 0081');
  const before=await snapshot();
  const beforeVersions=await versions();
  await apply(legacyWorkspaceNamespace);
  await assert.rejects(()=>scoped(c=>insert(c)),(error:unknown)=>
    error instanceof Error && error.message==='BUSINESS_NAMESPACE_REQUIRED',
  'The original incorrect order reproduces the hosted failure');
  await apply(repairWorkspaceNamespace);
  assert.deepEqual(await snapshot(),before);
  assert.deepEqual(await versions(),beforeVersions);
  await assert.rejects(()=>scoped(c=>insert(c,{...valid,storeMode:'SERVICE'})),/WORKSPACE_STORE_MODE_MISMATCH/);
  await assert.rejects(()=>scoped(c=>insert(c,{...valid,businessSector:'FNB'})),/WORKSPACE_PAYLOAD_MISMATCH/);
  await scoped(c=>insert(c));
  const repaired=await snapshot();
  const repairedVersions=await versions();
  assert.equal(repaired.rows.length,2);
  await apply(repairWorkspaceNamespace);
  assert.deepEqual(await snapshot(),repaired,'Replay preserves operational rows byte-for-byte');
  assert.deepEqual(await versions(),repairedVersions,'Replay does not touch record versions');
  const {rows:[permissions]}=await admin.query(`SELECT
    has_function_privilege('anon','pos.validate_shared_business_namespace()','EXECUTE') AS anon,
    has_function_privilege('authenticated','pos.validate_shared_business_namespace()','EXECUTE') AS authenticated,
    EXISTS(SELECT FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid='pos.validate_shared_business_namespace()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS public`);
  assert.deepEqual(permissions,{anon:false,authenticated:false,public:false});
  return {freshBootstrap:'PASS',lateLegacyFailureReproduced:'PASS',repairAndReplay:'PASS',
    workspacePayloadValidation:'PASS',legacyCompatibility:'PASS',rowAndVersionPreservation:'PASS',routineAcl:'PASS'};
}
