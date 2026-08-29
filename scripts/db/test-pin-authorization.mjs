#!/usr/bin/env node
/**
 * =============================================================================
 * TEST — STEP-UP AUTHORIZATION (PIN) SISI SERVER
 * =============================================================================
 * Membuktikan bahwa otorisasi PIN tidak lagi bergantung pada apa pun yang bisa
 * disentuh browser:
 *
 *   1. PIN benar diterima; PIN salah ditolak.
 *   2. Penghitung kegagalan dan lockout ada di pos.pin_attempts — bukan di
 *      localStorage — sehingga tidak bisa direset dari sisi klien.
 *   3. PIN teks polos warisan naik kelas ke PBKDF2 pada verifikasi pertama
 *      yang berhasil, dan kolom polosnya dikosongkan.
 *   4. Batasan peran ditegakkan (PIN kasir tidak bisa menyetujui aksi manajer).
 *   5. Unit usaha milik orang lain ditolak, walau id-nya benar.
 *
 *   node scripts/db/test-pin-authorization.mjs   (lewat: npm run db:test:pin)
 *
 * Berjalan di atas PGlite dengan seluruh migrasi diterapkan dari nol — jadi
 * yang diuji tabel, constraint, dan route yang sesungguhnya.
 * =============================================================================
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import express from 'express';
import { registerPinRoutes } from '../../services/pos/pinAuth.ts';
import { hashPin, verifyPin as verifyPinKdf } from '../../services/shared/pinKdf.ts';

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

const db = { query: (sql, params) => (params ? pg.query(sql, params) : pg.query(sql)) };

const stamp = Date.now();
const BUSINESS_ID = `biz-${stamp}`;
const OWNER_SUBJECT = `sub-owner-${stamp}`;
const OTHER_SUBJECT = `sub-orang-lain-${stamp}`;

/* -- Fixture: satu tenant + merchant milik OWNER_SUBJECT, dua anggota staf -- */

const tenant = (
  await db.query(
    `INSERT INTO pos.tenants (name, business_sector, owner_user_ref) VALUES ($1, 'FNB', $2) RETURNING id`,
    [`Kopi Uji ${stamp}`, OWNER_SUBJECT]
  )
).rows[0].id;
await db.query(
  `INSERT INTO internal.tenants (id, name, business_sector, owner_user_ref) VALUES ($1, $2, 'FNB', $3)`,
  [tenant, `Kopi Uji ${stamp}`, OWNER_SUBJECT]
);
const merchant = (
  await db.query(
    `INSERT INTO internal.merchants (tenant_id, name, business_sector, external_ref)
     VALUES ($1, $2, 'FNB', $3) RETURNING id`,
    [tenant, `Kopi Uji ${stamp}`, BUSINESS_ID]
  )
).rows[0].id;

async function addStaff(name, role, pinColumn, value) {
  const userId = (
    await db.query(`INSERT INTO internal.users (email, full_name) VALUES ($1, $2) RETURNING id`, [
      `${name}.${stamp}@uji.local`,
      name,
    ])
  ).rows[0].id;
  await db.query(
    `INSERT INTO internal.memberships (user_id, tenant_id, merchant_id, role, ${pinColumn})
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tenant, merchant, role, value]
  );
  return userId;
}

// Manajer masih memakai PIN teks polos warisan — inilah yang harus naik kelas.
await addStaff('Manajer Warisan', 'MANAGER', 'pin', '4821');
// Kasir sudah ber-hash PBKDF2 sejak awal.
await addStaff('Kasir Baru', 'CASHIER', 'pin_hash', await hashPin('1199'));

const app = express();
app.use(express.json());
// Meniru gateway: principal terverifikasi disuntik sebagai header tepercaya.
app.use((req, _res, next) => {
  const subject = req.headers['x-test-subject'];
  if (subject) req.headers['x-auth-sub'] = String(subject);
  next();
});
registerPinRoutes(app, db);

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function attempt(pin, { roles, subject = OWNER_SUBJECT, businessId = BUSINESS_ID } = {}) {
  const res = await fetch(`${base}/api/v1/pos/verify-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-subject': subject },
    body: JSON.stringify({ businessId, pin, requiredRoles: roles }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const lockoutRow = async () =>
  (
    await db.query(
      `SELECT consecutive_failures, lockout_count, locked_until FROM pos.pin_attempts
        WHERE merchant_id = $1 AND terminal_key = $2`,
      [merchant, OWNER_SUBJECT]
    )
  ).rows[0] || null;

try {
  console.log('1. VERIFIKASI DASAR\n');

  let r = await attempt('4821', { roles: ['ADMIN', 'MANAGER'] });
  check('PIN manajer yang benar diterima', r.status === 200 && r.body.ok === true, r.body.authorizedBy?.name || '');
  check('jawaban menyebut siapa yang menyetujui', r.body.authorizedBy?.role === 'MANAGER');

  r = await attempt('0000', { roles: ['ADMIN', 'MANAGER'] });
  check('PIN salah ditolak', r.status === 200 && r.body.ok === false, `sisa ${r.body.attemptsLeft}`);

  console.log('\n2. PIN WARISAN NAIK KELAS KE PBKDF2\n');

  const upgraded = (
    await db.query(
      `SELECT ms.pin, ms.pin_hash FROM internal.memberships ms
        JOIN internal.users u ON u.id = ms.user_id
       WHERE ms.merchant_id = $1 AND u.full_name = 'Manajer Warisan'`,
      [merchant]
    )
  ).rows[0];
  check('pin_hash terisi setelah verifikasi pertama', String(upgraded.pin_hash || '').startsWith('pbkdf2$'));
  check('kolom pin teks polos dikosongkan', !upgraded.pin);
  check(
    'hash barunya benar-benar cocok dengan PIN yang sama',
    (await verifyPinKdf('4821', upgraded.pin_hash)).ok === true
  );
  check('hash tidak cocok untuk PIN lain', (await verifyPinKdf('4822', upgraded.pin_hash)).ok === false);

  console.log('\n3. LOCKOUT DIHITUNG SERVER, BUKAN localStorage\n');

  // Bersihkan dulu agar hitungannya jelas: satu verifikasi berhasil = reset.
  await attempt('4821', { roles: ['ADMIN', 'MANAGER'] });

  await attempt('1111', { roles: ['ADMIN', 'MANAGER'] });
  const afterOne = await lockoutRow();
  check('kegagalan tercatat di pos.pin_attempts', Number(afterOne?.consecutive_failures) === 1);

  await attempt('2222', { roles: ['ADMIN', 'MANAGER'] });
  r = await attempt('3333', { roles: ['ADMIN', 'MANAGER'] });
  check('percobaan ketiga mengunci terminal', r.status === 423 && r.body.lockedOut === true, `${r.body.remainingSec}s`);

  const locked = await lockoutRow();
  check('locked_until tersimpan di database', Boolean(locked?.locked_until));

  r = await attempt('4821', { roles: ['ADMIN', 'MANAGER'] });
  check('PIN BENAR pun ditolak selama terkunci', r.status === 423 && r.body.ok === false);

  // Inilah inti perbaikannya: klien tidak punya apa pun untuk dihapus.
  const clientSideState = await lockoutRow();
  check(
    'status kunci hidup di server, tak bisa dihapus dari sisi klien',
    Boolean(clientSideState?.locked_until) && new Date(clientSideState.locked_until) > new Date()
  );

  console.log('\n4. PERAN & KEPEMILIKAN\n');

  // Lepas kunci untuk pengujian berikutnya.
  await db.query(`UPDATE pos.pin_attempts SET locked_until = NULL, consecutive_failures = 0
                   WHERE merchant_id = $1 AND terminal_key = $2`, [merchant, OWNER_SUBJECT]);

  r = await attempt('1199', { roles: ['ADMIN', 'MANAGER'] });
  check('PIN kasir tidak bisa menyetujui aksi manajer', r.status === 200 && r.body.ok === false);

  r = await attempt('1199', { roles: ['CASHIER'] });
  check('PIN kasir diterima untuk aksi kasir', r.status === 200 && r.body.ok === true);

  r = await attempt('4821', { roles: ['ADMIN', 'MANAGER'], subject: OTHER_SUBJECT });
  check('unit usaha milik orang lain ditolak', r.status === 403, r.body.error || '');

  r = await attempt('4821', { roles: ['ADMIN', 'MANAGER'], businessId: 'biz-tidak-ada' });
  check('businessId asing ditolak', r.status === 403 || r.status === 404, String(r.status));

  console.log(`\n${passed} PASS, ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
} catch (err) {
  console.error('\nFATAL:', err.message);
  process.exitCode = 1;
} finally {
  server.close();
  await pg.close();
}
