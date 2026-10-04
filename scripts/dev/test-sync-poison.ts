// One bad sale must never block the device queue. Real isolated PostgreSQL engine; no network.
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
import { newDocumentNumber } from '../../src/lib/ids';

const pg = new PGlite();
const wrap = (runner: any): Db => ({ query: async (sql, params) => { const r = await runner.query(sql, params); return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 }; },
  exec: async sql => { await runner.exec(sql); }, tx: async fn => pg.transaction(c => fn(wrap(c))), close: () => pg.close() });
const db = wrap(pg), owner = randomUUID(), tenant = randomUUID(), merchant = randomUUID(), outlet = randomUUID();
const files = ['migrations/0001_compat.sql', 'schema.sql', 'schema_hybrid_pos.sql', ...fs.readdirSync('migrations').filter(f => /^\d{4}_.*\.sql$/.test(f) && f !== '0001_compat.sql').sort().map(f => 'migrations/' + f)];
for (const file of files) await pg.exec(fs.readFileSync(file, 'utf8'));
for (const file of fs.readdirSync('supabase/migrations').filter(f => f.endsWith('_business_scoped_operational_state.sql')).sort()) await pg.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
await pg.exec(fs.readFileSync('docs/security/free-plan-selection.sql', 'utf8'));
await pastikanPaket(db, SAAS_PLANS);
await db.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,$2,'Owner')", [owner, owner + '@fixture.invalid']);
await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref,owner_user_id) VALUES($1,'Poison fixture',$2::text,$2::uuid)", [tenant, owner]);
await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$2,'Brand','FNB',$3)", [merchant, tenant, owner + '_FNB']);
await db.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name,is_active) VALUES($1,$2,$3,'Active',true)", [outlet, tenant, merchant]);
await ensureSubscription(db, tenant);
const app = express(); app.use(express.json());
app.use(createSyncHandler(async req => req.headers.authorization === 'Bearer owner' ? { subject: owner } : null, async () => db));
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + (server.address() as any).port;
const sale = (id: string, invoice: string, total = 20000) => ({ clientTxnId: id, invoiceNumber: invoice, cashierRef: owner, cashierName: 'Owner', subtotal: total, totalAmount: total,
  paymentMethod: 'CASH', paymentStatus: 'PAID', createdAt: new Date().toISOString(), items: [{ clientItemId: 'l1', productRef: 'p1', productName: 'Kopi', unitPrice: total, unitCost: 5000, quantity: 1, totalPrice: total }] });
const send = async (transactions: unknown[], idempotencyKey = randomUUID()) => {
  const response = await fetch(base + '/api/v1/sync/transactions', { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({ idempotencyKey, businessId: owner + '_FNB', sector: 'FNB', outletId: outlet, storeName: 'Poison fixture', transactions }) });
  return { status: response.status, data: await response.json() };
};
const count = async () => Number((await db.query('SELECT count(*)::int n FROM pos.transactions WHERE tenant_id=$1', [tenant])).rows[0].n);

try {
  // 1. A malformed sale is rejected alone; its neighbours are stored.
  const bad = { ...sale('bad-total', 'INV-A'), totalAmount: 20500 };
  let r = await send([sale('ok-1', 'INV-1'), bad, sale('ok-2', 'INV-2')]);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.accepted, 2);
  assert.deepEqual(r.data.rejected, [{ clientTxnId: 'bad-total', error: 'TOTAL_MISMATCH' }]);
  assert.equal(await count(), 2);

  // 2. An edited resend of a stored sale is quarantined; the new sale in the same batch is kept.
  r = await send([sale('ok-3', 'INV-3'), sale('ok-1', 'INV-1', 25000)]);
  assert.equal(r.status, 200); assert.equal(r.data.accepted, 1);
  assert.deepEqual(r.data.rejected, [{ clientTxnId: 'ok-1', error: 'TRANSACTION_ID_CONFLICT' }]);
  assert.equal(await count(), 3);

  // 3. Two devices printed the same receipt number: the sale is kept and renumbered, never a permanent 500.
  const key = randomUUID();
  r = await send([sale('device-b', 'INV-1')], key);
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.accepted, 1); assert.equal(r.data.renumbered.length, 1);
  assert.match(r.data.renumbered[0].invoiceNumber, /^INV-1-/);
  assert.equal(await count(), 4);

  // 4. Lost ACK: the exact replay reports the same per-sale outcome and stores nothing twice.
  const replay = await send([sale('device-b', 'INV-1')], key);
  assert.equal(replay.data.replayed, true); assert.deepEqual(replay.data.renumbered, r.data.renumbered);
  assert.equal(await count(), 4);
  const replayBad = await send([bad], 'bad-key'); const replayBad2 = await send([bad], 'bad-key');
  assert.deepEqual(replayBad2.data.rejected, replayBad.data.rejected, 'A replayed rejection is still a rejection');

  // 5. Only an unusable envelope rejects the whole batch.
  assert.equal((await send([null as any])).status, 400);

  // 6. Client: rejected sales move to quarantine, the queue keeps flowing, and they can be re-queued.
  const disk = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => disk.get(k) ?? null, setItem: (k: string, v: string) => disk.set(k, v), removeItem: (k: string) => disk.delete(k) }, configurable: true });
  const queue = await import('../../src/lib/sync/queue');
  const target = { businessId: owner + '_FNB', sector: 'FNB' as const, storeName: 'Poison fixture', ownerRef: owner, outletId: outlet };
  for (const t of [sale('q-ok', 'INV-Q1'), { ...sale('q-bad', 'INV-Q2'), totalAmount: 1 }, sale('q-ok-2', 'INV-Q3')]) queue.enqueue(target.businessId, { ...t, branchId: outlet, discountAmount: 0, taxAmount: 0, serviceChargeAmount: 0 } as any);
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: RequestInit) => realFetch(base + String(input), { ...init, headers: { ...(init?.headers as any), authorization: 'Bearer owner' } })) as typeof fetch;
  const status = await queue.flush(target as any, true);
  globalThis.fetch = realFetch;
  assert.equal(status.pending, 0, 'The queue is never held hostage by one sale');
  assert.equal(status.quarantined, 1);
  assert.equal(queue.readQuarantine(target.businessId)[0].error, 'TOTAL_MISMATCH');
  assert.equal(queue.requeueQuarantined(target.businessId, 'q-bad'), true);
  assert.equal(queue.getStatus(target.businessId).pending, 1); assert.equal(queue.getStatus(target.businessId).quarantined, 0);

  // 7. Receipt numbers carry 32 bits of entropy.
  assert.match(newDocumentNumber('INV', new Date('2026-10-04T00:00:00Z')), /^INV-20261004-[0-9A-F]{8}$/);
  console.log('PASS: per-sale accept/reject, quarantined edits, renumbered receipt collisions, replay-stable outcomes, client quarantine and requeue, 32-bit receipt numbers');
} finally { server.close(); await pg.close(); }
