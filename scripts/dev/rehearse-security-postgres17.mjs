import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { rehearsalTarget } from './rehearsal-target.mjs';

const client = new pg.Client({ connectionString: rehearsalTarget(process.env), ssl: false, connectionTimeoutMillis: 5000 });
const schemas = ['public', 'pos', 'internal', 'billing', 'ai', 'contract'];
const browserRoles = ['anon', 'authenticated'];
const backendRoles = ['service_role', 'svc_pos', 'svc_billing', 'svc_ai', 'svc_internal', 'bi_readonly'];
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const relation = row => quote(row.schema) + '.' + quote(row.name);
const hash = value => createHash('sha256').update(value).digest('hex');
const migrations = [
  ['20261013033203_browser_role_least_privilege.sql', null],
  ['20261013033208_server_financial_approvals.sql', '0059_server_financial_approvals.sql'],
  ['20261013033214_privacy_request_workflow.sql', '0060_privacy_request_workflow.sql'],
  ['20261013033217_ai_provider_consent_records.sql', '0061_ai_provider_consent_records.sql'],
  ['20261013033222_merchant_payment_provenance.sql', '0062_merchant_payment_provenance.sql'],
];
const evidence = { status: 'RUNNING', scope: 'Disposable PostgreSQL17; synthetic identities; no Supabase Auth/API/runtime credentials or production data', startedAt: new Date().toISOString(), revision: process.env.GITHUB_SHA || 'local-unrecorded', migrations: [], checks: {} };
async function sqlFile(path) {
  try { await client.query(fs.readFileSync(path, 'utf8')); }
  catch (error) { await client.query('ROLLBACK'); throw new Error(`Migration ${path} failed (SQLSTATE ${error.code || 'unknown'})`, { cause: error }); }
}
async function asRole(role, tenant, fn) {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE ' + quote(role));
    if (tenant !== null) await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    return await fn();
  } finally { await client.query('ROLLBACK'); }
}
async function deny(role, statement, code = '42501') {
  await assert.rejects(() => asRole(role, null, () => client.query(statement)), error => error.code === code);
}
async function relations() {
  return (await client.query("SELECT c.oid,n.nspname AS schema,c.relname AS name,c.relkind,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND c.relkind IN('r','p','v','m','S') ORDER BY c.oid", [schemas])).rows;
}
async function rights(objects, roles) {
  const rows = [];
  for (const r of objects) for (const role of roles) {
    const privileges = r.relkind === 'S' ? ['USAGE', 'SELECT', 'UPDATE'] : ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
    for (const privilege of privileges) {
      const fn = r.relkind === 'S' ? 'has_sequence_privilege' : 'has_table_privilege';
      rows.push([r.oid, role, privilege, (await client.query(`SELECT ${fn}($1,$2::oid,$3) allowed`, [role, r.oid, privilege])).rows[0].allowed]);
    }
    if (r.relkind !== 'S') rows.push([r.oid, role, 'columns', (await client.query("SELECT has_any_column_privilege($1,$2::oid,'SELECT,INSERT,UPDATE,REFERENCES') allowed", [role, r.oid])).rows[0].allowed]);
  }
  return rows;
}
async function functionRights(functions, roles) {
  const rows = [];
  for (const f of functions) for (const role of roles) rows.push([f.oid, role, (await client.query("SELECT has_function_privilege($1,$2::oid,'EXECUTE') allowed", [role, f.oid])).rows[0].allowed]);
  return rows;
}
async function defaults() {
  return (await client.query("SELECT d.defaclrole,d.defaclnamespace,d.defaclobjtype,a.grantee,a.privilege_type,a.is_grantable FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a ORDER BY 1,2,3,4,5,6")).rows;
}
async function fingerprints(objects, columns) {
  const result = [];
  for (const r of objects.filter(r => ['r', 'p'].includes(r.relkind))) {
    const cols = columns.get(r.oid);
    const rows = (await client.query(`SELECT json_build_array(${cols.map(quote).join(',')})::text AS data FROM ${relation(r)} ORDER BY 1`)).rows;
    result.push([r.oid, rows.length, hash(JSON.stringify(rows))]);
  }
  return result;
}
await client.connect();
try {
  const version = (await client.query('SHOW server_version_num')).rows[0].server_version_num;
  assert.equal(Math.floor(Number(version) / 10000), 17, 'Real PostgreSQL17 required; PGlite/other versions do not satisfy this gate');
  evidence.postgresVersion = (await client.query('SELECT version() v')).rows[0].v;
  const populated = await client.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN('r','p','v','m','S')");
  assert.equal(populated.rows[0].n, 0, 'Refuse a populated database before any DDL');
  await client.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS');
  const baselineFiles = ['migrations/0001_compat.sql', 'schema.sql', 'schema_hybrid_pos.sql', ...fs.readdirSync('migrations').filter(f => /^\d{4}_.*\.sql$/.test(f) && f !== '0001_compat.sql' && Number(f.slice(0,4)) <= 58).sort().map(f => 'migrations/' + f)];
  for (const file of baselineFiles) await sqlFile(file);
  evidence.baselineFiles = baselineFiles.map(path => ({ path, sha256: hash(fs.readFileSync(path)) }));
  // Deliberately reproduce unsafe browser/default ACLs with synthetic objects.
  for (const schema of schemas) await client.query(`
    GRANT USAGE ON SCHEMA ${quote(schema)} TO anon,authenticated,service_role;
    CREATE TABLE ${quote(schema)}.security_rehearsal_fixture(tenant text,outlet text);
    INSERT INTO ${quote(schema)}.security_rehearsal_fixture VALUES('tenant-A','outlet-A'),('tenant-B','outlet-B');
    GRANT ALL ON ${quote(schema)}.security_rehearsal_fixture TO anon,authenticated,service_role,svc_pos;
    GRANT SELECT(tenant) ON ${quote(schema)}.security_rehearsal_fixture TO authenticated;
    CREATE SEQUENCE ${quote(schema)}.security_rehearsal_seq;
    GRANT ALL ON SEQUENCE ${quote(schema)}.security_rehearsal_seq TO anon,authenticated,service_role;
    CREATE FUNCTION ${quote(schema)}.security_rehearsal_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';
    ALTER DEFAULT PRIVILEGES IN SCHEMA ${quote(schema)} GRANT ALL ON TABLES TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA ${quote(schema)} GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;
  `);
  const before = await relations();
  const columns = new Map();
  for (const r of before.filter(r => ['r','p'].includes(r.relkind))) columns.set(r.oid, (await client.query('SELECT attname FROM pg_attribute WHERE attrelid=$1 AND attnum>0 AND NOT attisdropped ORDER BY attnum', [r.oid])).rows.map(a => a.attname));
  const functions = (await client.query("SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1) AND p.prokind='f' ORDER BY p.oid", [schemas])).rows;
  const browserBefore = await rights(before,browserRoles), serviceBefore = await rights(before,backendRoles);
  const functionBrowserBefore = await functionRights(functions,browserRoles), functionServiceBefore = await functionRights(functions,backendRoles);
  const defaultsBefore = await defaults(), dataBefore = await fingerprints(before,columns);
  for (const [file, mirror] of migrations) {
    const path = 'supabase/migrations/' + file, source = fs.readFileSync(path);
    if (mirror) assert.deepEqual(source,fs.readFileSync('migrations/' + mirror),'Migration mirror must match byte-for-byte');
    await sqlFile(path);
    evidence.migrations.push({ path, sha256: hash(source) });
  }
  assert.deepEqual(await fingerprints(before,columns),dataBefore,'All preexisting column values preserved, including ledger/amount fields');
  assert.deepEqual((await relations()).filter(r => before.some(b => b.oid === r.oid)),before,'Existing RLS flags unchanged');
  assert.deepEqual(await rights(before,backendRoles),serviceBefore,'Known backend relation privileges preserved');
  assert.deepEqual(await functionRights(functions,backendRoles),functionServiceBefore,'Known helper execution preserved');
  evidence.checks.existingDataRlsAndBackendAccess = 'PASS';
  const after = await relations();
  let denials = 0;
  for (const role of browserRoles) for (const r of after) {
    if (r.relkind === 'S') await deny(role,`SELECT nextval('${relation(r)}')`);
    else {
      await deny(role,`SELECT * FROM ${relation(r)} LIMIT 0`);
      // PostgreSQL may reject non-updatable views during rewrite before ACL checking.
      // Their write privileges are checked separately; direct write probes use base tables.
      if (['r','p'].includes(r.relkind)) { await deny(role,`DELETE FROM ${relation(r)} WHERE false`); denials++; }
    }
    denials++;
  }
  assert((await rights(after,browserRoles)).every(row => row[3] === false),'No residual browser relation/column/sequence rights');
  const allFunctions = (await client.query("SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1) AND p.prokind='f' ORDER BY p.oid", [schemas])).rows;
  assert((await functionRights(allFunctions,browserRoles)).every(row => row[2] === false),'No residual browser function EXECUTE');
  evidence.checks.browserAccess = { status: 'PASS', relations: after.filter(r => r.relkind !== 'S').length, actualStatementsDenied: denials };
  await assert.rejects(() => sqlFile('supabase/migrations/' + migrations[0][0]), /Migration .* failed/);
  assert.equal((await client.query("SELECT count(*)::int n FROM internal.security_acl_rollback WHERE remediation='browser-role-20261012'")).rows[0].n > 0,true,'Reapply refusal preserves original snapshot');
  for (const schema of schemas) {
    await client.query(`CREATE TABLE ${quote(schema)}.security_future_fixture(id int); CREATE FUNCTION ${quote(schema)}.security_future_fn() RETURNS int LANGUAGE sql AS 'SELECT 2'`);
    for (const role of browserRoles) { await deny(role,`SELECT * FROM ${quote(schema)}.security_future_fixture`); await deny(role,`SELECT ${quote(schema)}.security_future_fn()`); }
  }
  evidence.checks.futureDefaultsAndReapplyRefusal = 'PASS';
  const tenantA = randomUUID(), tenantB = randomUUID(), merchantA = randomUUID(), merchantB = randomUUID(), requestA = randomUUID();
  await client.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Synthetic A','fixture-A'),($2,'Synthetic B','fixture-B')",[tenantA,tenantB]);
  await client.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector) VALUES($1,$2,'Synthetic A','FNB'),($3,$4,'Synthetic B','FNB')",[merchantA,tenantA,merchantB,tenantB]);
  await client.query("INSERT INTO pos.financial_pin_credentials(tenant_id,approver_ref,pin_hash) VALUES($1,'fixture-A','invalid-fixture-only'),($2,'fixture-B','invalid-fixture-only')",[tenantA,tenantB]);
  await client.query("INSERT INTO internal.privacy_requests(id,tenant_id,actor_ref,client_request_id,request_type,message) VALUES($1,$2,'fixture-A',$3,'ACCESS','Synthetic rehearsal'),($4,$5,'fixture-B',$6,'ACCESS','Synthetic rehearsal')",[requestA,tenantA,randomUUID(),randomUUID(),tenantB,randomUUID()]);
  for (const [tenant,merchant] of [[tenantA,merchantA],[tenantB,merchantB]]) {
    await client.query("INSERT INTO ai.provider_consent_events(tenant_id,merchant_id,actor_ref,notice_version,purpose,providers,granted) VALUES($1,$2,'synthetic','review-v2','BUSINESS_ANALYSIS',ARRAY['Agnes AI','DeepSeek'],true)",[tenant,merchant]);
    await client.query("INSERT INTO pos.merchant_payment_accounts(tenant_id,merchant_id,provider,provider_account_ref,settlement_model,licensed_provider_review_ref,owner_approval_ref) VALUES($1,$2,'FIXTURE_ONLY',$3,'MERCHANT_DIRECT','synthetic-no-license-claim','synthetic')",[tenant,merchant,randomUUID()]);
  }
  for (const [table,role] of [['pos.financial_pin_credentials','svc_pos'],['internal.privacy_requests','svc_pos'],['ai.provider_consent_events','svc_ai'],['pos.merchant_payment_accounts','svc_pos']]) {
    await asRole(role,null,async () => assert.equal((await client.query(`SELECT * FROM ${table}`)).rowCount,0,'Unset tenant denied'));
    await asRole(role,tenantA,async () => {
      assert.equal((await client.query(`SELECT * FROM ${table}`)).rowCount,1,'Own tenant visible');
      assert.equal((await client.query(`SELECT * FROM ${table} WHERE tenant_id=$1`,[tenantB])).rowCount,0,'Foreign tenant denied');
    });
    const id = randomUUID();
    const probes = {
      'pos.financial_pin_credentials': ["INSERT INTO pos.financial_pin_credentials(tenant_id,approver_ref,pin_hash) VALUES($1,$2,'fixture')",[tenantB,id]],
      'internal.privacy_requests': ["INSERT INTO internal.privacy_requests(tenant_id,actor_ref,client_request_id,request_type,message) VALUES($1,'fixture',$2,'ACCESS','Synthetic')",[tenantB,id]],
      'ai.provider_consent_events': ["INSERT INTO ai.provider_consent_events(tenant_id,merchant_id,actor_ref,notice_version,purpose,providers,granted) VALUES($1,$2,'fixture','v2','BUSINESS_ANALYSIS',ARRAY['Agnes AI','DeepSeek'],false)",[tenantB,merchantB]],
      'pos.merchant_payment_accounts': ["INSERT INTO pos.merchant_payment_accounts(tenant_id,merchant_id,provider,provider_account_ref,settlement_model,licensed_provider_review_ref,owner_approval_ref) VALUES($1,$2,'FIXTURE_ONLY',$3,'MERCHANT_DIRECT','synthetic','synthetic')",[tenantB,merchantB,id]],
    };
    await assert.rejects(() => asRole(role,tenantA,() => client.query(...probes[table])),error => error.code === '42501');
  }
  evidence.checks.serviceTenantIsolation = 'PASS: four new domain surfaces; own positive, unset/foreign read and foreign insert negative';
  await client.query("INSERT INTO pos.financial_authorization_audit(tenant_id,merchant_id,outlet_id,actor_ref,approver_ref,action,reference,reason,command_hash,grant_hash) VALUES($1,$2,$3,'fixture','fixture','VOID','synthetic','synthetic','hash','grant')",[tenantA,merchantA,randomUUID()]);
  await client.query("INSERT INTO internal.privacy_request_events(request_id,tenant_id,actor_ref,event,reason) VALUES($1,$2,'fixture','RECEIVED','synthetic')",[requestA,tenantA]);
  await client.query("INSERT INTO internal.legal_notice_acknowledgements(tenant_id,actor_ref,terms_version,privacy_version) VALUES($1,'fixture','review','review')",[tenantA]);
  const account = (await client.query('SELECT id FROM pos.merchant_payment_accounts WHERE tenant_id=$1',[tenantA])).rows[0].id;
  await client.query("INSERT INTO pos.payment_reconciliation_events(tenant_id,merchant_id,account_id,provider_event_ref,event_hash,outcome,reason) VALUES($1,$2,$3,'synthetic-event','hash','EXCEPTION','synthetic')",[tenantA,merchantA,account]);
  for (const [table,message] of [['pos.financial_authorization_audit','FINANCIAL_AUTHORIZATION_AUDIT_IMMUTABLE'],['internal.privacy_request_events','PRIVACY_EVIDENCE_IMMUTABLE'],['internal.legal_notice_acknowledgements','PRIVACY_EVIDENCE_IMMUTABLE'],['ai.provider_consent_events','AI_CONSENT_EVIDENCE_IMMUTABLE'],['pos.payment_reconciliation_events','RECONCILIATION_EVIDENCE_IMMUTABLE']]) {
    for (const statement of [`UPDATE ${table} SET tenant_id=tenant_id`,`DELETE FROM ${table}`,`TRUNCATE ${table}`]) await assert.rejects(() => asRole('service_role',null,() => client.query(statement)),error => error.message.includes(message));
  }
  evidence.checks.immutableAudit = 'PASS: UPDATE/DELETE/TRUNCATE refused for all five evidence tables, including service_role';
  await sqlFile('docs/security/compliance/rollback-browser-roles.sql');
  assert.deepEqual(await rights(before,browserRoles),browserBefore,'Captured rollback restores exact old browser relation/column/sequence privileges');
  assert.deepEqual(await functionRights(functions,browserRoles),functionBrowserBefore,'Captured old function privileges restored');
  assert.deepEqual(await defaults(),defaultsBefore,'Original default ACLs restored');
  assert.deepEqual(await rights(before,backendRoles),serviceBefore,'Rollback preserves known backend relation privileges');
  assert.deepEqual(await functionRights(functions,backendRoles),functionServiceBefore,'Temporary helper grants reversed exactly');
  const newObjects = (await relations()).filter(r => !before.some(b => b.oid === r.oid));
  assert((await rights(newObjects,browserRoles)).every(row => row[3] === false),'Rollback does not reopen new evidence tables');
  // Reapply in the disposable instance to finish with the protection restored.
  await sqlFile('supabase/migrations/' + migrations[0][0]);
  assert((await rights(await relations(),browserRoles)).every(row => row[3] === false));
  evidence.checks.capturedRollbackAndReapply = 'PASS; temporary vulnerable state existed only inside disposable test';
  evidence.status = 'PASS';
  console.log('PASS: PostgreSQL17 migration sequence, existing data/RLS/service preservation, browser and tenant negatives, immutable audit, exact rollback and reapply');
} catch (error) {
  evidence.status = 'FAIL';
  evidence.failure = { message: error.message, sqlState: error.code || error.cause?.code || null };
  throw error;
} finally {
  evidence.finishedAt = new Date().toISOString();
  fs.mkdirSync('build/security-rehearsal',{ recursive: true });
  fs.writeFileSync('build/security-rehearsal/postgres17.json',JSON.stringify(evidence,null,2)+'\n');
  await client.end();
}
