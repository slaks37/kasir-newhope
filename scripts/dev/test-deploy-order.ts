// Code deployed before migrations 0054/0055 keeps syncing correctly, and picks them up once applied. Isolated PGlite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import type { Db } from '../../services/shared/db';
import { createSyncHandler } from '../../src/server/syncHandler';
import { ensureSubscription } from '../../services/billing/engine';
import { pastikanPaket } from '../../services/billing/store';
import { SAAS_PLANS } from '../../src/config/saasPlans';
import { resetSchemaFeatureCache } from '../../services/shared/schemaFeatures';

const LATER = ['0054_sync_receipt_outcomes.sql', '0055_shared_state_versions.sql'];
const pg = new PGlite();
const wrap = (runner: any): Db => ({ query: async (sql, params) => { const r = await runner.query(sql, params); return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 }; },
  exec: async sql => { await runner.exec(sql); }, tx: async fn => pg.transaction(c => fn(wrap(c))), close: () => pg.close() });
const db = wrap(pg), owner = randomUUID(), tenant = randomUUID(), merchant = randomUUID(), outlet = randomUUID();
for (const file of ['migrations/0001_compat.sql', 'schema.sql', 'schema_hybrid_pos.sql', ...fs.readdirSync('migrations')
  .filter(f => /^\d{4}_.*\.sql$/.test(f) && f !== '0001_compat.sql' && !LATER.includes(f)).sort().map(f => 'migrations/' + f)])
  await pg.exec(fs.readFileSync(file, 'utf8'));
for (const file of fs.readdirSync('supabase/migrations').filter(f => f.endsWith('_business_scoped_operational_state.sql'))) await pg.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
await pg.exec(fs.readFileSync('docs/security/free-plan-selection.sql', 'utf8'));
await pastikanPaket(db, SAAS_PLANS);
await db.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Owner')", [owner, owner + '@fixture.invalid']);
await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref,owner_user_id) VALUES($1,'Deploy order',$2::text,$2::uuid)", [tenant, owner]);
await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$2,'Brand','FNB',$3)", [merchant, tenant, owner + '_FNB']);
await db.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name,is_active) VALUES($1,$2,$3,'Active',true)", [outlet, tenant, merchant]);
await ensureSubscription(db, tenant);

const app = express(); app.use(express.json());
app.use(createSyncHandler(async req => req.headers.authorization === 'Bearer owner' ? { subject: owner } : null, async () => db));
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + (server.address() as any).port;
const auth = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const sale = (id: string, total = 20000, reported = total) => ({ clientTxnId: id, invoiceNumber: 'INV-' + id, cashierRef: owner, cashierName: 'Owner', subtotal: total, totalAmount: reported,
  paymentMethod: 'CASH', paymentStatus: 'PAID', createdAt: new Date().toISOString(), items: [{ clientItemId: 'l1', productRef: 'p1', productName: 'Kopi', unitPrice: total, unitCost: 5000, quantity: 1, totalPrice: total }] });
const send = async (transactions: unknown[], idempotencyKey: string) => {
  const response = await fetch(base + '/api/v1/sync/transactions', { method: 'POST', headers: auth,
    body: JSON.stringify({ idempotencyKey, businessId: owner + '_FNB', sector: 'FNB', outletId: outlet, storeName: 'Deploy order', transactions }) });
  return { status: response.status, data: await response.json() };
};
const putProduct = async (id: string, baseRevision: number, price: number) => fetch(base + '/api/v1/sync/state', { method: 'POST', headers: auth,
  body: JSON.stringify({ sector: 'FNB', businessId: owner + '_FNB', outletId: outlet,
    operations: [{ kind: 'products', recordId: id, baseRevision, deleted: false, value: { id, name: 'Kopi ' + id, price, costPrice: 4000 } }] }) });
const state = async (known?: string) => (await fetch(base + `/api/v1/sync/state?paged=1&sector=FNB&businessId=${owner}_FNB${known ? '&knownVersion=' + known : ''}`, { headers: auth })).json() as Promise<any>;
const stored = async () => Number((await db.query('SELECT count(*)::int n FROM pos.transactions WHERE tenant_id=$1', [tenant])).rows[0].n);

try {
  assert.equal(((await pg.query(`SELECT to_regclass('pos.shared_state_versions') IS NULL AS absent`)).rows[0] as any).absent, true, 'Fixture starts without migration 0055');

  // Before 0054: per-sale outcomes cannot be stored. A lost-ACK replay must still report the rejection.
  const batch = [sale('ok-1'), sale('bad-1', 20000, 20500)];
  let r = await send(batch, 'key-mixed');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.accepted, r.data.rejected], [1, [{ clientTxnId: 'bad-1', error: 'TOTAL_MISMATCH' }]]);
  r = await send(batch, 'key-mixed');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.accepted, r.data.duplicates, r.data.rejected], [0, 1, [{ clientTxnId: 'bad-1', error: 'TOTAL_MISMATCH' }]],
    'Replay re-runs the batch: the stored sale is a duplicate and the bad one is rejected again, never reported as accepted');
  // A clean batch still gets a receipt and replays from it.
  r = await send([sale('ok-2')], 'key-clean');
  assert.equal(r.data.accepted, 1);
  r = await send([sale('ok-2')], 'key-clean');
  assert.deepEqual([r.status, r.data.replayed, r.data.accepted], [200, true, 1]);
  assert.equal(await stored(), 2);

  // Before 0055: state sync and change detection fall back to hashing the records.
  assert.equal((await putProduct('p-1', 0, 10000)).status, 200);
  let snapshot = await state();
  assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
  assert.ok(snapshot.records.some((row: any) => row.recordId === 'p-1' || row.record_id === 'p-1'));
  assert.equal((await state(snapshot.version)).unchanged, true, 'No change, no payload');
  assert.equal((await putProduct('p-1', 1, 12000)).status, 200);
  assert.notEqual((await state(snapshot.version)).unchanged, true, 'A write changes the version');

  // Migrations applied after the deploy are picked up (here after a cache reset; in production within a minute).
  for (const file of LATER) await pg.exec(fs.readFileSync('migrations/' + file, 'utf8'));
  resetSchemaFeatureCache();
  r = await send([sale('ok-3'), sale('bad-3', 20000, 1)], 'key-after');
  assert.deepEqual([r.data.accepted, r.data.rejected.length], [1, 1]);
  r = await send([sale('ok-3'), sale('bad-3', 20000, 1)], 'key-after');
  assert.deepEqual([r.data.replayed, r.data.rejected], [true, [{ clientTxnId: 'bad-3', error: 'TOTAL_MISMATCH' }]], 'With 0054 the replay answers from stored outcomes');
  snapshot = await state();
  assert.equal(snapshot.ok, true);
  assert.equal((await state(snapshot.version)).unchanged, true);
  assert.equal((await putProduct('p-1', 2, 13000)).status, 200);
  assert.notEqual((await state(snapshot.version)).unchanged, true, 'Trigger-maintained versions detect the write');
  console.log('PASS: deploy before migrations 0054/0055 keeps per-sale sync, lost-ACK replays and state polling correct, then adopts the migrations once applied');
} finally { server.close(); await pg.close(); }
