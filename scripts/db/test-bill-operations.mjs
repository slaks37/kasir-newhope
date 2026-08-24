#!/usr/bin/env node
/**
 * =============================================================================
 * TEST — BILL OPERATIONS, NON-REVENUE TENDERS & DEPOSIT LIABILITY (0037)
 * =============================================================================
 * Membuktikan empat klaim yang bikin fitur POS klasik (House Use, Join Bill,
 * Change Price, Deposit) tidak menabrak invarian yang sudah ada:
 *
 *   1. Bill House Use TIDAK masuk contract.merchant_revenue, tapi tetap
 *      terlihat di contract.non_revenue_log.
 *   2. Bill yang sudah di-Join (MERGED) tidak dihitung dua kali sebagai omzet.
 *   3. Change Price / Void Item ditolak database kalau tanpa persetujuan
 *      Manager atau tanpa alasan — Step-Up Auth ditegakkan, bukan diharapkan.
 *   4. Saldo deposit dihitung trigger, tidak bisa minus, dan mutasinya
 *      append-only.
 *
 *   node scripts/db/test-bill-operations.mjs           embedded PGlite
 *   node scripts/db/test-bill-operations.mjs --live    pakai $DATABASE_URL
 *
 * Mode embedded menjalankan seluruh migrasi dari nol, jadi tes ini berdiri
 * sendiri — tidak menuntut database yang sudah ter-seed.
 * =============================================================================
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import 'dotenv/config';

const ROOT = process.cwd();
const MIGRATION_DIR = join(ROOT, 'migrations');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(62)} ${detail}`);
}

/** Menjalankan SQL yang HARUS ditolak database. Lulus kalau memang ditolak. */
async function expectReject(query, name, sql, params) {
  try {
    await query(sql, params);
    check(name, false, 'tidak ditolak — trigger/constraint tidak aktif');
  } catch (err) {
    check(name, true, String(err.message).slice(0, 58));
  }
}

async function connect() {
  if (process.argv.includes('--live') && process.env.DATABASE_URL) {
    const pg = (await import('pg')).default;
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    console.log(`MODE: LIVE — ${process.env.DATABASE_URL.replace(/:[^:@]*@/, ':***@')}\n`);
    return {
      query: (sql, params) => client.query(sql, params),
      close: () => client.end(),
      migrate: async () => {},
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create();
  console.log('MODE: EMBEDDED — PGlite\n');
  return {
    query: (sql, params) => (params ? db.query(sql, params) : db.query(sql)),
    close: () => db.close(),
    migrate: async () => {
      const files = [
        join(ROOT, 'schema_hybrid_pos.sql'),
        join(ROOT, 'schema.sql'),
        ...readdirSync(MIGRATION_DIR)
          .filter((f) => /^\d{4}_.*\.sql$/.test(f))
          .sort()
          .map((f) => join(MIGRATION_DIR, f)),
      ];
      for (const f of files) await db.exec(readFileSync(f, 'utf8'));
    },
  };
}

const { query, close, migrate } = await connect();

try {
  await migrate();

  /* ---------------------------------------------------------------------- */
  /* Fixture — satu tenant, satu merchant, satu outlet, satu manager         */
  /* ---------------------------------------------------------------------- */

  const stamp = Date.now();

  // pos.transactions masih ber-FK ke pos.tenants/pos.users (tabel warisan),
  // sementara tabel-tabel baru ber-FK ke internal.tenants/internal.users.
  // 0014 menyamakan id-nya lewat backfill sekali jalan, jadi fixture ini
  // menulis ke kedua sisi dengan id yang sama persis.
  const tenant = (
    await query(`INSERT INTO pos.tenants (name, business_sector) VALUES ($1, 'FNB') RETURNING id`, [
      `Tes Bill Ops ${stamp}`,
    ])
  ).rows[0].id;

  await query(`INSERT INTO internal.tenants (id, name, business_sector) VALUES ($1, $2, 'FNB')`, [
    tenant,
    `Tes Bill Ops ${stamp}`,
  ]);

  const merchant = (
    await query(
      `INSERT INTO internal.merchants (tenant_id, name, business_sector) VALUES ($1, $2, 'FNB') RETURNING id`,
      [tenant, `Kafe Uji ${stamp}`]
    )
  ).rows[0].id;

  const outlet = (
    await query(
      `INSERT INTO internal.outlets (tenant_id, merchant_id, name) VALUES ($1, $2, 'Cabang Uji') RETURNING id`,
      [tenant, merchant]
    )
  ).rows[0].id;

  /** Membuat satu staf di kedua bidang identitas dengan id yang sama. */
  async function makeUser(fullName, username, role) {
    const id = (
      await query(
        `INSERT INTO pos.users (tenant_id, name, username, pin, role) VALUES ($1, $2, $3, '0000', $4) RETURNING id`,
        [tenant, fullName, `${username}.${stamp}`, role]
      )
    ).rows[0].id;
    await query(`INSERT INTO internal.users (id, email, full_name) VALUES ($1, $2, $3)`, [
      id,
      `${username}.${stamp}@uji.local`,
      fullName,
    ]);
    return id;
  }

  const cashier = await makeUser('Kasir Uji', 'kasir', 'CASHIER');
  const manager = await makeUser('Manajer Uji', 'manajer', 'MANAGER');

  const customer = (
    await query(
      `INSERT INTO pos.customers (tenant_id, merchant_id, name, phone) VALUES ($1, $2, 'Bu Sari', $3) RETURNING id`,
      [tenant, merchant, `0811${stamp}`.slice(0, 15)]
    )
  ).rows[0].id;

  /** Membuat satu bill lunas. */
  async function makeBill({ total, method = 'CASH', impact = 'SALE', status = 'COMPLETED' }) {
    return (
      await query(
        `INSERT INTO pos.transactions
           (tenant_id, merchant_id, outlet_id, cashier_user_id, invoice_number,
            business_sector, business_date, order_status, payment_status,
            payment_method, revenue_impact, subtotal, tax_amount, total_amount)
         VALUES ($1, $2, $3, $4, $5, 'FNB', CURRENT_DATE, $6, 'PAID', $7, $8, $9, 0, $9)
         RETURNING id`,
        [
          tenant,
          merchant,
          outlet,
          cashier,
          `INV-${stamp}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          status,
          method,
          impact,
          total,
        ]
      )
    ).rows[0].id;
  }

  /* ---------------------------------------------------------------------- */
  console.log('1. HOUSE USE TIDAK MENGGELEMBUNGKAN OMZET');
  /* ---------------------------------------------------------------------- */

  await makeBill({ total: 100000, impact: 'SALE' });
  const houseUseBill = await makeBill({ total: 250000, method: 'HOUSE_USE', impact: 'HOUSE_USE' });

  const revenue = Number(
    (
      await query(
        `SELECT COALESCE(SUM(total_amount), 0) AS s FROM contract.merchant_revenue WHERE merchant_id = $1`,
        [merchant]
      )
    ).rows[0].s
  );
  check('omzet hanya menghitung bill SALE', revenue === 100000, `Rp ${revenue.toLocaleString('id-ID')}`);

  // contract.merchant_revenue diganti pakai CREATE OR REPLACE, bukan DROP
  // CASCADE. Kalau salah, view turunannya ikut hilang tanpa suara.
  const dependents = Number(
    (
      await query(
        `SELECT COUNT(*)::int AS n FROM information_schema.views
          WHERE table_schema = 'contract' AND table_name IN ('catalog', 'transaction_log', 'payments_log')`
      )
    ).rows[0].n
  );
  check('view turunan merchant_revenue tetap utuh', dependents === 3, `${dependents}/3 view`);
  await query(`SELECT 1 FROM contract.catalog LIMIT 1`);
  check('contract.catalog masih bisa di-query', true);

  const nonRev = (
    await query(`SELECT revenue_impact, total_amount FROM contract.non_revenue_log WHERE transaction_id = $1`, [
      houseUseBill,
    ])
  ).rows[0];
  check(
    'bill House Use tetap terlihat di non_revenue_log',
    nonRev?.revenue_impact === 'HOUSE_USE' && Number(nonRev.total_amount) === 250000,
    nonRev ? `${nonRev.revenue_impact} Rp ${Number(nonRev.total_amount).toLocaleString('id-ID')}` : 'tidak ada'
  );

  /* ---------------------------------------------------------------------- */
  console.log('\n2. JOIN BILL TIDAK DIHITUNG DUA KALI');
  /* ---------------------------------------------------------------------- */

  const billA = await makeBill({ total: 60000 });
  const billB = await makeBill({ total: 40000 });
  const billGabungan = await makeBill({ total: 100000 });

  // Meja A dan B digabung ke satu bill: keduanya jadi MERGED.
  for (const src of [billA, billB]) {
    await query(
      `UPDATE pos.transactions
          SET order_status = 'MERGED', merged_into_transaction_id = $2
        WHERE id = $1`,
      [src, billGabungan]
    );
    await query(
      `INSERT INTO pos.bill_operations
         (tenant_id, merchant_id, outlet_id, operation_type, source_transaction_id,
          target_transaction_id, performed_by_user_id, reason)
       VALUES ($1, $2, $3, 'JOIN_BILL', $4, $5, $6, 'Tamu minta digabung')`,
      [tenant, merchant, outlet, src, billGabungan, cashier]
    );
  }

  const revenueAfterJoin = Number(
    (
      await query(
        `SELECT COALESCE(SUM(total_amount), 0) AS s FROM contract.merchant_revenue WHERE merchant_id = $1`,
        [merchant]
      )
    ).rows[0].s
  );
  // 100.000 (bill awal) + 100.000 (bill gabungan). Rp 60rb + Rp 40rb tidak dihitung lagi.
  check(
    'bill sumber yang sudah MERGED keluar dari omzet',
    revenueAfterJoin === 200000,
    `Rp ${revenueAfterJoin.toLocaleString('id-ID')} (bukan Rp 300.000)`
  );

  const joinOps = Number(
    (
      await query(
        `SELECT COUNT(*)::int AS n FROM contract.bill_operations_log
          WHERE merchant_id = $1 AND operation_type = 'JOIN_BILL'`,
        [merchant]
      )
    ).rows[0].n
  );
  check('operasi Join tercatat di jejak audit bill', joinOps === 2, `${joinOps} operasi`);

  /* ---------------------------------------------------------------------- */
  console.log('\n3. STEP-UP AUTHORIZATION DITEGAKKAN DATABASE');
  /* ---------------------------------------------------------------------- */

  const priceBill = await makeBill({ total: 75000 });

  await expectReject(
    query,
    'Change Price tanpa persetujuan Manager ditolak',
    `INSERT INTO pos.bill_operations
       (tenant_id, merchant_id, outlet_id, operation_type, source_transaction_id,
        performed_by_user_id, reason, amount_delta)
     VALUES ($1, $2, $3, 'CHANGE_PRICE', $4, $5, 'Harga khusus langganan', -10000)`,
    [tenant, merchant, outlet, priceBill, cashier]
  );

  await expectReject(
    query,
    'Change Price tanpa alasan ditolak',
    `INSERT INTO pos.bill_operations
       (tenant_id, merchant_id, outlet_id, operation_type, source_transaction_id,
        performed_by_user_id, approved_by_user_id, amount_delta)
     VALUES ($1, $2, $3, 'CHANGE_PRICE', $4, $5, $6, -10000)`,
    [tenant, merchant, outlet, priceBill, cashier, manager]
  );

  await expectReject(
    query,
    'Move Item tanpa bill tujuan ditolak',
    `INSERT INTO pos.bill_operations
       (tenant_id, merchant_id, outlet_id, operation_type, source_transaction_id, performed_by_user_id)
     VALUES ($1, $2, $3, 'MOVE_ITEM', $4, $5)`,
    [tenant, merchant, outlet, priceBill, cashier]
  );

  const okOp = (
    await query(
      `INSERT INTO pos.bill_operations
         (tenant_id, merchant_id, outlet_id, operation_type, source_transaction_id,
          performed_by_user_id, approved_by_user_id, reason, amount_delta)
       VALUES ($1, $2, $3, 'CHANGE_PRICE', $4, $5, $6, 'Harga khusus langganan', -10000)
       RETURNING id`,
      [tenant, merchant, outlet, priceBill, cashier, manager]
    )
  ).rows[0].id;
  check('Change Price lengkap (approver + alasan) diterima', Boolean(okOp));

  const approvedBy = (
    await query(`SELECT approved_by_name FROM contract.bill_operations_log WHERE id = $1`, [okOp])
  ).rows[0].approved_by_name;
  check('jejak menyebut siapa yang menyetujui', approvedBy === 'Manajer Uji', approvedBy || '-');

  await expectReject(
    query,
    'UPDATE jejak operasi bill ditolak (append-only)',
    `UPDATE pos.bill_operations SET amount_delta = 0 WHERE id = $1`,
    [okOp]
  );
  await expectReject(
    query,
    'DELETE jejak operasi bill ditolak (append-only)',
    `DELETE FROM pos.bill_operations WHERE id = $1`,
    [okOp]
  );

  /* ---------------------------------------------------------------------- */
  console.log('\n4. BUKU BESAR DEPOSIT / VOUCHER');
  /* ---------------------------------------------------------------------- */

  const account = (
    await query(
      `INSERT INTO pos.customer_deposits (tenant_id, merchant_id, outlet_id, customer_id, account_type)
       VALUES ($1, $2, $3, $4, 'DEPOSIT') RETURNING id`,
      [tenant, merchant, outlet, customer]
    )
  ).rows[0].id;

  const topup = (
    await query(
      `INSERT INTO pos.deposit_movements
         (tenant_id, merchant_id, outlet_id, deposit_account_id, movement_type, amount, performed_by_user_id)
       VALUES ($1, $2, $3, $4, 'TOPUP', 500000, $5) RETURNING balance_after`,
      [tenant, merchant, outlet, account, cashier]
    )
  ).rows[0].balance_after;
  check('TOPUP mengisi balance_after dari trigger', Number(topup) === 500000, `Rp ${Number(topup).toLocaleString('id-ID')}`);

  const redeem = (
    await query(
      `INSERT INTO pos.deposit_movements
         (tenant_id, merchant_id, outlet_id, deposit_account_id, movement_type, amount, performed_by_user_id)
       VALUES ($1, $2, $3, $4, 'REDEEM', -120000, $5) RETURNING balance_after`,
      [tenant, merchant, outlet, account, cashier]
    )
  ).rows[0].balance_after;
  check('REDEEM mengurangi saldo dengan benar', Number(redeem) === 380000, `Rp ${Number(redeem).toLocaleString('id-ID')}`);

  await expectReject(
    query,
    'penebusan melebihi saldo ditolak',
    `INSERT INTO pos.deposit_movements
       (tenant_id, merchant_id, outlet_id, deposit_account_id, movement_type, amount, performed_by_user_id)
     VALUES ($1, $2, $3, $4, 'REDEEM', -900000, $5)`,
    [tenant, merchant, outlet, account, cashier]
  );

  const balance = Number(
    (
      await query(`SELECT balance FROM contract.customer_deposit_balances WHERE deposit_account_id = $1`, [account])
    ).rows[0].balance
  );
  check('saldo kontrak sama dengan hasil mutasi', balance === 380000, `Rp ${balance.toLocaleString('id-ID')}`);

  /* ---------------------------------------------------------------------- */
  console.log('\n5. REKONSILIASI TENDER TUTUP SHIFT');
  /* ---------------------------------------------------------------------- */

  const tenders = (
    await query(
      `SELECT tender_code, affects_cash_drawer, counts_as_revenue, tender_amount
         FROM contract.tender_settlement
        WHERE merchant_id = $1 ORDER BY tender_code`,
      [merchant]
    )
  ).rows;

  const cash = tenders.find((t) => t.tender_code === 'CASH');
  const house = tenders.find((t) => t.tender_code === 'HOUSE_USE');
  check('tender CASH ditandai masuk laci kas', cash?.affects_cash_drawer === true, `Rp ${Number(cash?.tender_amount || 0).toLocaleString('id-ID')}`);
  check('tender HOUSE_USE tidak masuk laci kas', house?.affects_cash_drawer === false, house ? 'terdeteksi' : 'tidak ada');
  check('tender HOUSE_USE ditandai bukan pendapatan', house?.counts_as_revenue === false);

  console.log(`\n${passed} PASS, ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
} catch (err) {
  console.error('\nFATAL:', err.message);
  process.exitCode = 1;
} finally {
  await close();
}
