#!/usr/bin/env node
/**
 * =============================================================================
 * TEST — OTORISASI /api/admin/*
 * =============================================================================
 * Menjaga tiga aturan yang mudah sekali longgar kembali tanpa disadari:
 *
 *   1. Route konsol penyedia hanya hidup di PROVIDER_BO. MERCHANT_BO ditolak,
 *      supaya konsol internal tidak ikut terbuka di domain merchant.
 *   2. Email yang bukan staf internal ditolak — tidak pernah diberi identitas
 *      cadangan.
 *   3. /api/admin/identities tidak lagi membocorkan daftar email + role staf
 *      internal kepada pemanggil yang belum berhak.
 *
 *   node scripts/db/test-admin-authorization.mjs
 *
 * Database di-stub: yang diuji lapisan otorisasinya, bukan datanya. Stub-nya
 * setia — baris internal_users hanya keluar untuk email yang memang ter-seed.
 * =============================================================================
 */

import express from 'express';
import process from 'node:process';
import { registerAdminRoutes } from '../../src/server/adminRoutes.ts';

// Flag dev harus mati: kalau hidup, MERCHANT_BO sengaja diizinkan dan tes
// nomor 1 akan gagal untuk alasan yang benar. Tes ini menguji perilaku produksi.
delete process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT;

const SEEDED_SUPERADMIN = 'ops@newhopepos.id';

const stubDb = {
  query: async (sql, params) => {
    if (sql.includes('internal.internal_users')) {
      const asked = String(params?.[0] ?? '');
      return asked === SEEDED_SUPERADMIN
        ? {
            rows: [
              {
                id: '00000000-0000-0000-0000-000000000001',
                email: SEEDED_SUPERADMIN,
                full_name: 'Platform Root',
                role: 'ROLE_SUPERADMIN',
              },
            ],
          }
        : { rows: [] };
    }
    if (sql.includes('internal_access_log')) return { rows: [] };
    return { rows: [] };
  },
};

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(60)} ${detail}`);
}

const app = express();
registerAdminRoutes(app, async () => stubDb);

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const PROVIDER = { 'x-forwarded-host': 'admin.domainanda.com' };
const MERCHANT = { 'x-forwarded-host': 'app.domainanda.com' };
const AS_ROOT = { 'x-internal-user': SEEDED_SUPERADMIN };

const status = async (path, headers) => (await fetch(`${base}${path}`, { headers })).status;

try {
  console.log('1. LINGKUNGAN — konsol penyedia tidak boleh hidup di domain merchant\n');

  check(
    'PROVIDER_BO + identitas internal diterima',
    (await status('/api/admin/overview', { ...PROVIDER, ...AS_ROOT })) === 200
  );
  check(
    'MERCHANT_BO ditolak walau identitasnya sah',
    (await status('/api/admin/overview', { ...MERCHANT, ...AS_ROOT })) === 404
  );
  check(
    'x-env-override MERCHANT_BO tidak membuka jalan',
    (await status('/api/admin/overview', {
      ...MERCHANT,
      ...AS_ROOT,
      'x-env-override': 'MERCHANT_BO',
    })) === 404
  );
  check(
    'host tak dikenal ditolak (gagal tertutup)',
    (await status('/api/admin/overview', { 'x-forwarded-host': 'toko-acak.vercel.app', ...AS_ROOT })) === 404
  );

  console.log('\n2. IDENTITAS — hanya staf internal terdaftar\n');

  check(
    'tanpa header identitas ditolak',
    (await status('/api/admin/overview', PROVIDER)) === 404
  );
  check(
    'email di luar internal_users ditolak',
    (await status('/api/admin/overview', { ...PROVIDER, 'x-internal-user': 'penyerang@gmail.com' })) === 404
  );

  console.log('\n3. ENUMERASI — daftar staf internal tidak boleh bocor\n');

  check(
    '/api/admin/identities tanpa identitas ditolak',
    (await status('/api/admin/identities', PROVIDER)) === 404
  );
  check(
    '/api/admin/identities dari domain merchant ditolak',
    (await status('/api/admin/identities', { ...MERCHANT, ...AS_ROOT })) === 404
  );
  check(
    '/api/admin/identities terbuka untuk SUPERADMIN di PROVIDER_BO',
    (await status('/api/admin/identities', { ...PROVIDER, ...AS_ROOT })) === 200
  );

  console.log(`\n${passed} PASS, ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
} catch (err) {
  console.error('\nFATAL:', err.message);
  process.exitCode = 1;
} finally {
  server.close();
}
