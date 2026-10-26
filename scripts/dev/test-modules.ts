import { kindsForModule } from '../../src/lib/sync/moduleKinds';
import { calendarDate } from '../../src/lib/reports/client';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import type { Db } from '../../services/shared/db';
import { createSyncHandler } from '../../src/server/syncHandler';
import { resetSchemaFeatureCache } from '../../services/shared/schemaFeatures';
import { pastikanPaket } from '../../services/billing/store';
import { ensureSubscription } from '../../services/billing/engine';
import { SAAS_PLANS } from '../../src/config/saasPlans';
import { moduleRegistry, effectivePages } from '../../src/platform/modules/registry';
import { modulePath, parseModuleRoute } from '../../src/platform/modules/routing';
import { guardedPath, isLandingPath, moduleForPath, safeReturnPath } from '../../src/lib/navigation/routes';
assert.equal(calendarDate('Asia/Jakarta',0,new Date('2026-10-25T17:05:00Z')), '2026-10-26', 'Booking day uses WIB across UTC midnight boundary');
assert.equal(calendarDate('Asia/Jakarta',-1,new Date('2026-10-25T17:05:00Z')), '2026-10-25');
assert(kindsForModule('tables','BARBERSHOP').includes('staff_members') && kindsForModule('tables','BARBERSHOP').includes('products'), 'Direct barber booking hydrates roster and service catalog');
assert(!kindsForModule('tables','FNB').includes('carwash_queue') && !kindsForModule('tables','FNB').includes('bookings'), 'Inactive sector records are not hydrated');
assert(kindsForModule('tables','CARWASH').includes('staff_members') && !kindsForModule('tables','CARWASH').includes('kds_tickets'));
const pg = new PGlite();
const wrap = (runner: any): Db => ({ query: async (sql, params) => { const r = await runner.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; }, exec: async sql => { await runner.exec(sql); }, tx: async fn => pg.transaction(c => fn(wrap(c))), close: () => pg.close() });
const db = wrap(pg);
const owner = randomUUID(), outsider = randomUUID(), cashier = randomUUID(), manager = randomUUID(), tenant = randomUUID(), otherTenant = randomUUID();
const files = ['migrations/0001_compat.sql', 'schema.sql', 'schema_hybrid_pos.sql', ...fs.readdirSync('migrations').filter(f => /^\d{4}_.*\.sql$/.test(f) && !['0001_compat.sql','0063_module_assignments.sql','0067_workspace_isolation.sql'].includes(f)).sort().map(f => 'migrations/' + f)];
await pg.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;');
for (const file of files) await pg.exec(fs.readFileSync(file, 'utf8'));
for (const file of fs.readdirSync('supabase/migrations').filter(f => f.endsWith('_business_scoped_operational_state.sql')).sort()) await pg.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
await pg.exec(fs.readFileSync('docs/security/free-plan-selection.sql', 'utf8'));
await pastikanPaket(db, SAAS_PLANS);
for (const id of [owner, outsider, cashier, manager]) await db.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Synthetic module fixture')", [id, id + '@fixture.invalid']);
await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref,owner_user_id) VALUES($1,'Module fixture',$2::text,$2::uuid),($3,'Other tenant',$4::text,$4::uuid)", [tenant, owner, otherTenant, outsider]);
await ensureSubscription(db, tenant); await ensureSubscription(db, otherTenant);
const scopes = new Map<string, { businessId: string; outletId: string }>();
for (const manifest of Object.values(moduleRegistry)) {
  const businessId = randomUUID(), outletId = randomUUID();
  scopes.set(manifest.id, { businessId, outletId });
  await db.query('INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$2,$3,$4,$5)', [businessId, tenant, manifest.name, manifest.sector, owner + '_' + manifest.sector]);
  await db.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$3,'Main')", [outletId, tenant, businessId]);
  for (const page of manifest.pages) {
    const path = modulePath(businessId, outletId, manifest.id, page.id);
    assert.equal(parseModuleRoute(path)?.moduleId, manifest.id);
    assert.equal(moduleForPath(path), page.tab);
    assert.equal(safeReturnPath(path), path);
    assert.equal(isLandingPath(path), false);
    assert.equal(guardedPath(path, false), '/login?returnTo=' + encodeURIComponent(path));
  }
  assert(effectivePages(manifest, { id: manifest.id, permissions: ['overview'], features: ['overview','reports'] }, () => true).every(p => p.id === 'dashboard'));
}
assert.equal(new Set(Object.values(moduleRegistry).map(m => m.pages.find(p => p.id === 'operations')!.label)).size, 5);
for (const bad of ['/app', '/app/foreign/outlet/retail/dashboard', '/app/' + randomUUID() + '/' + randomUUID() + '/hidden/dashboard', '/app/' + randomUUID() + '/' + randomUUID() + '/retail/%2freports']) {
  assert.equal(parseModuleRoute(bad), null); assert.equal(isLandingPath(bad), false);
  assert(guardedPath(bad, false).startsWith('/login?returnTo=')); assert.equal(safeReturnPath(bad), '/overview');
}
const fnb = scopes.get('fnb')!;
const app = express(); app.use(express.json());
app.use(createSyncHandler(async req => {
  const subjects: Record<string, string> = { owner, outsider, cashier, manager };
  const subject = subjects[String(req.headers.authorization || '').replace('Bearer ', '')];
  return subject ? { subject } : null;
}, async () => db));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const base = 'http://127.0.0.1:' + (server.address() as any).port;
const get = async (endpoint: string, scope: Record<string, string>, token = 'owner') => {
  const response = await fetch(base + '/api/v1/sync/modules/' + endpoint + '?' + new URLSearchParams(scope), { headers: { authorization: 'Bearer ' + token, 'x-auth-sub': owner, 'x-auth-role': 'OWNER' } });
  return { status: response.status, data: await response.json(), cache: response.headers.get('cache-control') };
};
try {
  process.env.NEW_HOPE_MODULE_WORKSPACES = '1';
  assert.equal((await get('access', fnb)).data.enabled, false, 'Deploy before migration remains compatible');
  await pg.exec(fs.readFileSync('migrations/0063_module_assignments.sql', 'utf8'));
  await pg.exec(fs.readFileSync('migrations/0063_module_assignments.sql', 'utf8'));
  await pg.exec(fs.readFileSync('migrations/0064_membership_tenant_reference.sql', 'utf8'));
  await pg.exec(fs.readFileSync('migrations/0067_workspace_isolation.sql','utf8'));
  resetSchemaFeatureCache();
  assert.equal((await get('access', fnb)).data.modules.length, 0, 'No assignment or entitlement is inferred from sector');
  for (const [moduleId, scope] of scopes) {
    await db.query('INSERT INTO internal.merchant_modules(tenant_id,merchant_id,module_id,enabled,guard_legacy_apis) VALUES($1,$2,$3,true,true)', [tenant, scope.businessId, moduleId]);
    assert.equal((await get('access', scope)).data.modules.length, 0, 'Assignment alone never grants a paid feature');
    await db.query("INSERT INTO billing.module_entitlements(tenant_id,merchant_id,module_id,enabled,features,expires_at,grant_reference) VALUES($1,$2,$3,true,$4,now()+interval '1 day','synthetic-local-only')", [tenant, scope.businessId, moduleId, ['overview','pos','tables','inventory','customers','reports','ai','labor','settings','payment','businesses']]);
    const allowed = await get('access', { ...scope, moduleId, page: 'operations' });
    assert.equal(allowed.status, 200); assert.equal(allowed.cache, 'no-store'); assert.equal(allowed.data.modules[0].id, moduleId);
    const dash = await get('dashboard', { ...scope, moduleId, page: 'dashboard' });
    assert.equal(dash.status, 200); assert.equal(dash.data.total, 0);
  }
  const retailScope = scopes.get('retail')!;
  await db.query("INSERT INTO pos.shared_state_records(tenant_id,merchant_id,scope,kind,record_id,value) VALUES($1,$2,'RETAIL','products','stock-unknown',$3),($1,$2,'RETAIL','products','stock-low',$4)", [tenant, retailScope.businessId, { id: 'stock-unknown', stock: 'invalid-legacy-number' }, { id: 'stock-low', stock: 2, minStockAlert: 3 }]);
  const stock = await get('dashboard', { ...retailScope, moduleId: 'retail', page: 'dashboard' });
  assert.equal(stock.status, 200); assert.deepEqual(stock.data.buckets, [{ status: 'LOW_STOCK', count: 1 }, { status: 'UNKNOWN', count: 1 }], 'Malformed legacy stock is unknown, never fabricated as available and never crashes the aggregate');
  for (const token of ['anonymous','outsider']) assert.equal((await get('access', fnb, token)).status, token === 'anonymous' ? 401 : 403);
  assert.equal((await get('access', { ...fnb, outletId: scopes.get('retail')!.outletId })).status, 403);
  assert.equal((await get('access', { ...fnb, moduleId: 'retail', page: 'dashboard' })).status, 403, 'Hidden direct module denied');
  await db.query('INSERT INTO internal.memberships(id,user_id,tenant_id,merchant_id,outlet_id,scope_type,role) VALUES($1,$2,$3,$4,$5,\'OUTLET\',\'CASHIER\'),($6,$7,$3,$4,NULL,\'MERCHANT\',\'MANAGER\')', [randomUUID(), cashier, tenant, fnb.businessId, fnb.outletId, randomUUID(), manager]);
  assert.equal((await get('access', { ...fnb, moduleId: 'fnb', page: 'pos' }, 'cashier')).status, 200);
  assert.equal((await get('access', { ...fnb, moduleId: 'fnb', page: 'reports' }, 'cashier')).status, 403, 'Forged browser OWNER header cannot grant reports');
  assert.equal((await get('access', scopes.get('retail')!, 'cashier')).status, 403, 'Outlet member cannot cross merchant');
  const report = { ...fnb, moduleId: 'fnb', page: 'reports', from: '2026-10-01', to: '2026-10-26' };
  assert.equal((await get('revenue', report, 'manager')).status, 403, 'Merchant manager cannot obtain tenant-owner aggregates');
  assert.equal((await get('revenue', { ...report, to: '2027-12-01' })).status, 400);
  assert.equal((await get('revenue', { ...report, from: '2026-02-30' })).status, 400);
  assert.equal((await get('revenue', report)).status, 200);
  const submitSale = async (moduleId: string, value: number, token = 'owner') => {
    const scope = scopes.get(moduleId)!;
    const body = { businessId: (token === 'owner' ? owner : outsider) + '_' + moduleRegistry[moduleId as keyof typeof moduleRegistry].sector,
      sector: moduleRegistry[moduleId as keyof typeof moduleRegistry].sector, outletId: scope.outletId, storeName: 'Synthetic report test', idempotencyKey: 'module-report-' + moduleId,
      transactions: [{ clientTxnId: 'module-sale-' + moduleId, subtotal: value, totalAmount: value, paymentMethod: 'CASH', paymentStatus: 'PAID', createdAt: '2026-10-24T03:00:00Z',
        items: [{ clientItemId: 'module-line-' + moduleId, productName: 'Synthetic fixture only', unitPrice: value, unitCost: 10, quantity: 1 }] }] };
    const send = async () => { const response = await fetch(base + '/api/v1/sync/transactions', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
    const first = await send(); assert.equal(first.status, 200, JSON.stringify(first)); assert.equal(first.data.accepted, 1, JSON.stringify(first));
    const second = await send(); assert.equal(second.status, 200); assert.equal(second.data.replayed, true);
  };
  await submitSale('fnb', 100); await submitSale('retail', 50);
  const sale = (await db.query("SELECT id FROM pos.transactions WHERE tenant_id=$1 AND client_txn_id='module-sale-fnb'", [tenant])).rows[0];
  await db.query("INSERT INTO pos.transaction_refunds(tenant_id,merchant_id,outlet_id,transaction_id,client_refund_id,amount,subtotal_amount,refund_method,reason) VALUES($1,$2,$3,$4,'module-refund',20,20,'CASH','Synthetic local refund fixture')", [tenant, fnb.businessId, fnb.outletId, sale.id]);
  const syncStatusResponse = await fetch(base + '/api/v1/sync/status?' + new URLSearchParams({ businessId: fnb.businessId }), {headers:{authorization:'Bearer owner'}});
  const syncStatus=await syncStatusResponse.json();assert.equal(syncStatusResponse.status,200,JSON.stringify(syncStatus));assert.equal(Number(syncStatus.synced_revenue),80,'Legacy status reads canonical net revenue after refund');
  const netReport = await get('revenue', report);
  assert.equal(netReport.status, 200); assert.equal(netReport.data.rows.length, 2);
  assert.equal(Number(netReport.data.rows[0].total_net_revenue), 130, 'Consolidated canonical revenue includes net refunds without double counting retried sales');
  assert.equal(Number(netReport.data.rows[0].total_transactions), 2);
  assert(netReport.data.rows.every((row: any) => row.moduleId === null && row.attribution === 'historical_sector'), 'Sector history is never mislabeled as verified module attribution');
  assert.equal((await get('revenue', report, 'outsider')).status, 403);

  await db.query("INSERT INTO pos.shared_state_records(tenant_id,merchant_id,scope,kind,record_id,value) VALUES($1,$2,'FNB','kds_tickets','ticket-a',$3)", [tenant, fnb.businessId, { id: 'ticket-a', status: 'PREPARING', branchId: fnb.outletId }]);
  const sibling = randomUUID(), siblingOutlet = randomUUID();
  await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$2,'Sibling FNB','FNB',$3)", [sibling, tenant, owner + '_business_' + sibling]);
  await db.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$3,'Sibling')", [siblingOutlet, tenant, sibling]);
  await db.query("INSERT INTO pos.shared_state_records(tenant_id,merchant_id,scope,kind,record_id,value) VALUES($1,$2,$4,'kds_tickets','ticket-a',$3)", [tenant, sibling, { id: 'ticket-a', status: 'READY', branchId: siblingOutlet }, 'BUSINESS:' + sibling]);
  const dashboard = await get('dashboard', { ...fnb, moduleId: 'fnb', page: 'dashboard' });
  assert.equal(dashboard.data.total, 1); assert.deepEqual(dashboard.data.buckets, [{ status: 'PREPARING', count: 1 }], 'Same-sector sibling record never contaminates dashboard');
  await db.query("INSERT INTO pos.shared_state_records(tenant_id,merchant_id,scope,kind,record_id,value,updated_at) VALUES($1,$2,$4,'kds_tickets','ticket-a',$3,now()+interval '1 second')", [tenant, fnb.businessId, { id: 'ticket-a', status: 'READY', branchId: fnb.outletId }, 'BUSINESS:' + fnb.businessId]);
  const deduped = await get('dashboard', { ...fnb, moduleId: 'fnb', page: 'dashboard' });
  assert.deepEqual(deduped.data.buckets, [{ status: 'READY', count: 1 }], 'Legacy and UUID namespaces never double-count the same operational record');
  await db.query("UPDATE billing.module_entitlements SET expires_at=now()-interval '1 second' WHERE merchant_id=$1", [fnb.businessId]);
  assert.equal((await get('access', { ...fnb, moduleId: 'fnb', page: 'pos' })).status, 403);
  await db.query("UPDATE billing.module_entitlements SET expires_at=now()+interval '1 day',features=ARRAY['overview'] WHERE merchant_id=$1", [fnb.businessId]);
  assert.equal((await get('access', { ...fnb, moduleId: 'fnb', page: 'pos' })).status, 403, 'Purchased features separately restrict pages');
  const native = async (path: string, body?: unknown) => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await native('/api/v1/sync/catalog?' + new URLSearchParams({ sector: 'FNB', businessId: fnb.businessId }))).status, 403, 'Legacy catalog cannot bypass module entitlement');
  assert.equal((await native('/api/v1/sync/status?' + new URLSearchParams({ businessId: fnb.businessId }))).status, 403, 'Legacy financial status cannot bypass module entitlement');
  assert.equal((await native('/api/v1/reports/summary?' + new URLSearchParams({ sector: 'FNB', outletId: fnb.outletId }))).status, 403, 'Legacy report endpoint cannot bypass module entitlement');
  assert.equal((await native('/api/v1/sync/state?' + new URLSearchParams({ sector: 'FNB', businessId: fnb.businessId, kinds: 'products' }))).status, 403, 'Legacy state read cannot bypass module entitlement');
  const deniedState = { sector: 'FNB', businessId: fnb.businessId, outletId: fnb.outletId, operations: [{ kind: 'kds_tickets', recordId: 'denied', baseRevision: 0, deleted: false, value: { id: 'denied', status: 'READY' } }] };
  assert.equal((await native('/api/v1/sync/state', deniedState)).status, 403, 'Unauthorized operational command rejected before writing');
  const deniedSale = { businessId: owner + '_FNB', sector: 'FNB', outletId: fnb.outletId, transactions: [{ clientTxnId: 'denied-module-sale', subtotal: 50, totalAmount: 50, items: [{ productName: 'Synthetic denied', unitPrice: 50, quantity: 1 }] }] };
  assert.equal((await native('/api/v1/sync/transactions', deniedSale)).status, 403, 'Unauthorized queued sale rejected without inventing a ledger record');
  assert.equal((await db.query("SELECT id FROM pos.transactions WHERE client_txn_id='denied-module-sale'")).rows.length, 0);
  assert.equal((await native('/api/v1/finance/shift/open', { sector: 'FNB', outletId: fnb.outletId, clientShiftId: 'denied-shift', cashierName: 'Synthetic', initialCash: 0 })).status, 403, 'Legacy finance write cannot bypass module entitlement');
  assert.equal((await native('/api/v1/sync/state?' + new URLSearchParams({ sector: 'FNB', businessId: sibling, kinds: 'kds_tickets' }))).status, 200, 'Unenrolled legacy merchant retains existing behavior');
  await db.query("UPDATE internal.merchant_modules SET enabled=false WHERE merchant_id=$1", [fnb.businessId]);
  assert.equal((await native('/api/v1/sync/state?' + new URLSearchParams({ sector: 'FNB', businessId: fnb.businessId, kinds: 'users' }))).status, 403, 'Disabled pilot assignment cannot fall back to legacy API authorization');
  await db.query("UPDATE internal.merchant_modules SET enabled=true WHERE merchant_id=$1", [fnb.businessId]);

  await db.query("UPDATE billing.module_entitlements SET features=ARRAY['overview','pos','reports','tables'] WHERE merchant_id=$1", [fnb.businessId]);
  const permittedState=await native('/api/v1/sync/state',deniedState);assert.equal(permittedState.status,200,JSON.stringify(permittedState));assert.equal(permittedState.data.versions.length,1,JSON.stringify(permittedState));
  assert.equal((await db.query("SELECT value->>'status' AS status FROM pos.shared_state_records WHERE merchant_id=$1 AND kind='kds_tickets' AND record_id='denied'",[fnb.businessId])).rows[0]?.status,'READY','Restored entitlement permits the real durable operational write');
  await db.query("INSERT INTO internal.outlet_modules(tenant_id,merchant_id,outlet_id,module_id,enabled) VALUES($1,$2,$3,'fnb',false)", [tenant, fnb.businessId, fnb.outletId]);
  assert.equal((await get('access', { ...fnb, moduleId: 'fnb', page: 'dashboard' })).status, 403, 'Outlet override narrows merchant grant');
  await db.query("UPDATE internal.outlet_modules SET enabled=true WHERE merchant_id=$1", [fnb.businessId]);
  await db.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$2,$3,'Second')", [randomUUID(), tenant, fnb.businessId]);
  assert.equal((await get('access', { ...fnb, moduleId: 'fnb', page: 'dashboard' })).status, 403, 'Unsafe legacy multi-outlet adapter fails closed');
  process.env.NEW_HOPE_MODULE_WORKSPACES = '0';
  assert.equal((await get('access', scopes.get('retail')!)).data.enabled, false);
  for (const role of ['anon','authenticated']) {
    await db.exec('SET ROLE ' + role);
    for (const table of ['internal.merchant_modules','internal.outlet_modules','billing.module_entitlements']) await assert.rejects(() => db.query('SELECT * FROM ' + table), /permission denied/);
    await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE svc_pos');
  assert.equal((await db.query('SELECT * FROM internal.merchant_modules')).rows.length, 0, 'Service without transaction scope sees no assignment');
  await assert.rejects(() => db.query("UPDATE internal.merchant_modules SET enabled=true"), /permission denied/);
  await db.exec('RESET ROLE');
  await db.tx(async c => {
    await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)", [tenant, scopes.get('retail')!.businessId]);
    await c.exec('SET LOCAL ROLE svc_pos');
    assert.equal((await c.query('SELECT * FROM internal.merchant_modules')).rows.length, 1, 'RLS limits service to exact merchant');
    assert.equal((await c.query('SELECT * FROM billing.module_entitlements')).rows.length, 1);
  });
  console.log('PASS: all five manifests/routes, module/page entitlement, member RBAC, tenant/merchant/outlet isolation, sibling namespace, real dashboard aggregates, rollout compatibility, additive migration replay and service/browser RLS');
} finally { await new Promise<void>(resolve => server.close(() => resolve())); await pg.close(); delete process.env.NEW_HOPE_MODULE_WORKSPACES; }
