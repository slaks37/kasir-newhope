#!/usr/bin/env node
/**
 * =============================================================================
 * TEST — PENEGAKAN LANGGANAN DI SISI SERVER
 * =============================================================================
 * Layar kunci langganan di aplikasi kasir membaca status dari localStorage,
 * jadi ia bisa dilewati siapa pun yang mau mengubahnya. Penjaga yang nyata ada
 * di pos-service, dan tes ini memaku dua sisi keputusannya:
 *
 *   1. Langganan EXPIRED menolak PRODUK BARU (HTTP 402).
 *   2. Langganan EXPIRED tetap MENERIMA PENJUALAN atas produk yang sudah ada.
 *
 * Nomor 2 sama pentingnya dengan nomor 1, dan lebih mudah rusak tanpa sengaja.
 * Transaksi yang gagal masuk hilang selamanya dari pembukuan merchant; kerugian
 * itu jauh melebihi satu bulan langganan yang tertunggak. Menolak tumbuh
 * berbeda dari menolak mencatat kenyataan.
 *
 *   node scripts/db/test-subscription-enforcement.mjs   (npm run db:test:subscription)
 * =============================================================================
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import express from 'express';
import { registerSyncRoutes } from '../../services/pos/sync.ts';

const ROOT = process.cwd();
const MIGRATION_DIR = join(ROOT, 'migrations');

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)} ${detail}`);
}

const { PGlite } = await import('@electric-sql/pglite');
const pg = await PGlite.create();
for (const f of [
  join(ROOT, 'schema_hybrid_pos.sql'),
  join(ROOT, 'schema.sql'),
  ...readdirSync(MIGRATION_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .map((f) => join(MIGRATION_DIR, f)),
]) {
  await pg.exec(readFileSync(f, 'utf8'));
}

const db = {
  query: (sql, params) => (params ? pg.query(sql, params) : pg.query(sql)),
  /*
   * db.tx yang sesungguhnya, bukan pura-pura.
   *
   * Kalau stub-nya hanya memanggil fn tanpa BEGIN/ROLLBACK, batch yang gagal
   * separuh jalan akan tampak "tercatat" di tes padahal di produksi ia
   * dibatalkan seluruhnya. Tes yang lebih longgar dari kenyataan justru
   * menyembunyikan bug yang ingin dicarinya.
   */
  tx: async (fn) => {
    await pg.query('BEGIN');
    try {
      const out = await fn(db);
      await pg.query('COMMIT');
      return out;
    } catch (err) {
      await pg.query('ROLLBACK');
      throw err;
    }
  },
};

const stamp = Date.now();
const BUSINESS_ID = `biz-sub-${stamp}`;
const OWNER = `sub-owner-${stamp}`;

/*
 * billing.subscriptions ber-FK ke pos.tenants (tabel warisan), sementara
 * contract.merchant_product_entitlement membaca internal.tenants. Migrasi 0014
 * menyamakan id keduanya lewat backfill sekali jalan, jadi fixture ini menulis
 * ke kedua sisi dengan id yang sama persis.
 */
const tenant = (
  await db.query(
    `INSERT INTO pos.tenants (name, business_sector, owner_user_ref, external_ref)
     VALUES ($1, 'FNB', $2, $2) RETURNING id`,
    [`Toko Langganan ${stamp}`, OWNER]
  )
).rows[0].id;
await db.query(
  `INSERT INTO internal.tenants (id, name, business_sector, owner_user_ref, external_ref)
   VALUES ($1, $2, 'FNB', $3, $3)`,
  [tenant, `Toko Langganan ${stamp}`, OWNER]
);
await db.query(
  `INSERT INTO internal.merchants (tenant_id, name, business_sector, external_ref)
   VALUES ($1, $2, 'FNB', $3)`,
  [tenant, `Toko Langganan ${stamp}`, BUSINESS_ID]
);

const planId = `plan-uji-${stamp}`;
await db.query(
  `INSERT INTO billing.plans (id, name, tier_level, billing_cycle, price_idr, product_limit)
   VALUES ($1, 'Uji', 2, 'MONTHLY', 100000, 100)`,
  [planId]
);

async function setSubscription(status) {
  await db.query(`DELETE FROM billing.subscriptions WHERE tenant_id = $1`, [tenant]);
  await db.query(
    `INSERT INTO billing.subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP - INTERVAL '30 days', CURRENT_TIMESTAMP)`,
    [tenant, planId, status]
  );
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.headers['x-auth-sub'] = OWNER;
  next();
});
registerSyncRoutes(app, db);

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

let seq = 0;
async function syncSale(productName) {
  seq += 1;
  const res = await fetch(`${base}/api/v1/sync/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `idem-${stamp}-${seq}`,
      businessId: BUSINESS_ID,
      sector: 'FNB',
      storeName: `Toko Langganan ${stamp}`,
      transactions: [
        {
          clientTxnId: `txn-${stamp}-${seq}`,
          invoiceNumber: `INV-${stamp}-${seq}`,
          subtotal: 25000,
          totalAmount: 25000,
          paymentMethod: 'CASH',
          paymentStatus: 'PAID',
          createdAt: new Date().toISOString(),
          items: [{ productRef: productName, productName, unitPrice: 25000, quantity: 1, totalPrice: 25000 }],
        },
      ],
    }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const countTransactions = async () =>
  Number((await db.query(`SELECT COUNT(*)::int n FROM pos.transactions WHERE tenant_id = $1`, [tenant])).rows[0].n);

try {
  console.log('1. LANGGANAN AKTIF — semuanya boleh\n');

  await setSubscription('ACTIVE');
  let r = await syncSale('Kopi Susu');
  check('produk baru diterima saat langganan aktif', r.status === 200 && r.body.ok === true);
  check('transaksinya tercatat', (await countTransactions()) === 1);

  console.log('\n2. LANGGANAN KEDALUWARSA — berhenti tumbuh\n');

  await setSubscription('EXPIRED');
  r = await syncSale('Menu Baru Yang Belum Pernah Ada');
  check('produk baru DITOLAK', r.status === 402, r.body.error || String(r.status));
  check(
    'alasannya jelas untuk merchant',
    String(r.body.detail || '').includes('Penjualan tetap tercatat'),
    r.body.detail || ''
  );

  console.log('\n3. LANGGANAN KEDALUWARSA — TETAP mencatat penjualan\n');

  const before = await countTransactions();
  r = await syncSale('Kopi Susu'); // produk yang SUDAH ada
  check(
    'penjualan produk lama tetap diterima walau langganan mati',
    r.status === 200 && r.body.ok === true,
    r.body.error || ''
  );
  check('transaksinya benar-benar masuk database', (await countTransactions()) === before + 1);

  console.log('\n4. LANGGANAN DIBATALKAN diperlakukan sama\n');

  await setSubscription('CANCELED');
  r = await syncSale('Menu Lain Lagi');
  check('produk baru ditolak saat CANCELED', r.status === 402);

  const after = await countTransactions();
  r = await syncSale('Kopi Susu');
  check('penjualan produk lama tetap diterima saat CANCELED', r.status === 200 && r.body.ok === true);
  check('dan tetap tercatat', (await countTransactions()) === after + 1);

  console.log(`\n${passed} PASS, ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
} catch (err) {
  console.error('\nFATAL:', err.message);
  process.exitCode = 1;
} finally {
  server.close();
  await pg.close();
}
