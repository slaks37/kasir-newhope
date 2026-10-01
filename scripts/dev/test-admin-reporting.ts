// Isolated query regression: fixtures are deliberate audit/canonical contracts,
// not production data. Canonical view eligibility is tested with server reports.
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { transactionLog } from '../../src/server/repo';
import type { Db } from '../../services/shared/db';

const pg = new PGlite();
const db: Db = {
  query: async (sql, params) => { const r = await pg.query(sql, params); return { rows: r.rows as any[], rowCount: r.rows.length }; },
  exec: async sql => { await pg.exec(sql); },
  tx: async fn => fn(db),
  close: () => pg.close(),
};
const tenant = '00000000-0000-0000-0000-000000000001';
const merchant = '00000000-0000-0000-0000-000000000002';
const outlet = '00000000-0000-0000-0000-000000000003';
try {
  await pg.exec(`CREATE SCHEMA contract; CREATE SCHEMA internal; CREATE SCHEMA pos;
    CREATE TABLE contract.refund_totals(transaction_id uuid,tenant_id uuid,amount numeric);
    CREATE TABLE internal.merchant_settings(merchant_id uuid,timezone text);
    CREATE TABLE contract.transaction_log(id uuid,tenant_id uuid,merchant_id uuid,outlet_id uuid,
      business_sector text,app_module text,created_at timestamptz,invoice_number text,merchant_name text,
      total_amount numeric,order_status text,payment_status text);
    CREATE TABLE contract.merchant_revenue(id uuid,tenant_id uuid,total_amount numeric,refund_amount numeric);`);
  await db.query('INSERT INTO internal.merchant_settings VALUES($1,$2)', [merchant, 'Asia/Jakarta']);
  for (const [i, status, amount, net, refund, date] of [
    [1, 'COMPLETED', 55000, 55000, 0, '2026-09-30T17:00:00Z'],
    [2, 'SETTLED', 45000, 30000, 15000, '2026-10-01T08:00:00Z'],
    [3, 'VOIDED', 50000, null, 0, '2026-10-01T09:00:00Z'],
    [4, 'CANCELLED', 15000, null, 0, '2026-10-01T10:00:00Z'],
    [5, 'REFUNDED', 20000, 0, 20000, '2026-10-01T11:00:00Z'],
    [6, 'COMPLETED', 1000, 1000, 0, '2026-10-01T17:00:00Z'],
  ] as const) {
    const id = `10000000-0000-0000-0000-00000000000${i}`;
    await db.query('INSERT INTO contract.transaction_log VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [id, tenant, merchant, outlet, 'FNB', 'POS', date, 'INVOICE-' + i, 'Merchant', amount, status, status === 'REFUNDED' ? 'REFUNDED' : 'PAID']);
    if (net !== null) await db.query('INSERT INTO contract.merchant_revenue VALUES($1,$2,$3,$4)', [id, tenant, net, refund]);
  }
  const filters = { tenantId: tenant, merchantId: merchant, outletId: outlet, from: '2026-10-01', to: '2026-10-01' };
  const result = await transactionLog(db, filters);
  assert.equal(result.total, 5);
  assert.equal(result.revenueAmount, 85000);
  assert.equal(result.sumAmount, 85000);
  assert.equal(result.auditAmount, 185000);
  assert.equal(result.refundAmount, 35000);
  assert.equal(result.voidCancelledAmount, 65000);
  assert.deepEqual(result.counts, { revenue: 3, completed: 2, voided: 1, cancelled: 1, refunded: 2 });
  assert.equal(result.timezone, 'Asia/Jakarta');
  assert.equal(result.rows.find((r: any) => r.order_status === 'VOIDED').revenue_amount, 0);
  const page = await transactionLog(db, { ...filters, limit: 1, offset: 200 });
  assert.equal(page.rows.length, 0);
  assert.equal(page.revenueAmount, result.revenueAmount);
  const searched = await transactionLog(db, { ...filters, search: 'INVOICE-3' });
  assert.equal(searched.total, 1);
  assert.equal(searched.revenueAmount, 0);
  const utc = await transactionLog(db, { ...filters, timezone: 'UTC' });
  assert.equal(utc.revenueAmount, 31000);
  assert.equal((await transactionLog(db, { ...filters, outletId: tenant })).total, 0);
  assert.equal((await transactionLog(db, { ...filters, tenantId: outlet })).total, 0);
  for (const bad of [{ from: '2026-02-30' }, { timezone: 'Mars/Test' }, { outletId: ['bad'] }, { from: '2026-10-02', to: '2026-10-01' }]) {
    await assert.rejects(() => transactionLog(db, { ...filters, ...bad }), /INVALID_/);
  }
  console.log('PASS: admin audit statuses, canonical net/refund totals, scope/date/timezone filters and pagination');
} finally { await pg.close(); }
