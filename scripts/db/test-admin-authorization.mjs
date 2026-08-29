#!/usr/bin/env node
/**
 * =============================================================================
 * TEST — OTORISASI /api/admin/*
 * =============================================================================
 * Menjaga empat aturan yang mudah sekali longgar kembali tanpa disadari:
 *
 *   1. Route konsol penyedia hanya hidup di PROVIDER_BO. MERCHANT_BO ditolak,
 *      supaya konsol internal tidak ikut terbuka di domain merchant.
 *   2. Identitas datang dari sesi terverifikasi gateway (x-auth-sub), BUKAN
 *      dari header `x-internal-user` yang bisa diketik siapa saja.
 *   3. Gateway tidak meneruskan header identitas dan lingkungan kiriman klien.
 *   4. /api/admin/identities tidak membocorkan daftar email + role staf
 *      internal kepada pemanggil yang belum berhak.
 *
 *   node scripts/db/test-admin-authorization.mjs        (lewat: npm run db:test:admin-auth)
 *
 * Database di-stub: yang diuji lapisan otorisasinya, bukan datanya. Stub-nya
 * setia — kursi internal hanya cocok untuk subject/email yang memang ter-seed,
 * dan pengikatan sso_subject hanya boleh terjadi sekali.
 * =============================================================================
 */

import express from 'express';
import process from 'node:process';
import { registerAdminRoutes } from '../../src/server/adminRoutes.ts';
import { HEADER_TIDAK_DITERUSKAN } from '../../services/shared/proxyHeaders.ts';

// Flag dev harus mati: kalau hidup, MERCHANT_BO diizinkan dan x-internal-user
// diterima kembali — keduanya memang disengaja untuk dev. Tes ini menguji
// perilaku produksi.
delete process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT;

const SEEDED_EMAIL = 'ops@newhopepos.id';
const SEEDED_SUBJECT = 'sub-ops-terikat';
const SEED_ROW = {
  id: '00000000-0000-0000-0000-000000000001',
  email: SEEDED_EMAIL,
  full_name: 'Platform Root',
  role: 'ROLE_SUPERADMIN',
};

/** Kursi internal: satu baris, sso_subject awalnya kosong. */
let seat = { ...SEED_ROW, sso_subject: null };

const stubDb = {
  query: async (sql, params) => {
    if (sql.includes('UPDATE internal.internal_users')) {
      const [subject, email] = params;
      // Meniru `WHERE lower(email) = $2 AND sso_subject IS NULL`.
      if (seat.sso_subject === null && seat.email.toLowerCase() === email) {
        seat = { ...seat, sso_subject: subject };
        return { rows: [SEED_ROW] };
      }
      return { rows: [] };
    }
    if (sql.includes('WHERE sso_subject = $1')) {
      return seat.sso_subject === params[0] ? { rows: [SEED_ROW] } : { rows: [] };
    }
    if (sql.includes('internal.internal_users')) {
      return String(params?.[0] ?? '') === SEEDED_EMAIL ? { rows: [SEED_ROW] } : { rows: [] };
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
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(62)} ${detail}`);
}

const app = express();
registerAdminRoutes(app, async () => stubDb);

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const PROVIDER = { 'x-forwarded-host': 'admin.domainanda.com' };
const MERCHANT = { 'x-forwarded-host': 'app.domainanda.com' };
/** Yang diisi gateway sesudah sesi Supabase terverifikasi. */
const SESSION = { 'x-auth-sub': SEEDED_SUBJECT, 'x-auth-email': SEEDED_EMAIL };

const status = async (path, headers) => (await fetch(`${base}${path}`, { headers })).status;

try {
  console.log('1. IDENTITAS — dari sesi terverifikasi, bukan header yang diketik klien\n');

  check(
    'header x-internal-user saja TIDAK cukup lagi',
    (await status('/api/admin/overview', { ...PROVIDER, 'x-internal-user': SEEDED_EMAIL })) === 404
  );
  check(
    'sesi terverifikasi mengklaim kursi (bind pertama) dan diterima',
    (await status('/api/admin/overview', { ...PROVIDER, ...SESSION })) === 200
  );
  check(
    'sesudah terikat, kursi dikenali lewat sso_subject',
    seat.sso_subject === SEEDED_SUBJECT && (await status('/api/admin/overview', { ...PROVIDER, ...SESSION })) === 200
  );
  check(
    'orang lain dengan email sama TIDAK bisa merebut kursi yang sudah terikat',
    (await status('/api/admin/overview', {
      ...PROVIDER,
      'x-auth-sub': 'sub-penyerang',
      'x-auth-email': SEEDED_EMAIL,
    })) === 404
  );
  check(
    'sesi sah tapi email di luar internal_users ditolak',
    (await status('/api/admin/overview', {
      ...PROVIDER,
      'x-auth-sub': 'sub-merchant-biasa',
      'x-auth-email': 'pemilik.warung@gmail.com',
    })) === 404
  );
  check('tanpa sesi ditolak', (await status('/api/admin/overview', PROVIDER)) === 404);

  console.log('\n2. LINGKUNGAN — konsol penyedia tidak hidup di domain merchant\n');

  check(
    'MERCHANT_BO ditolak walau sesinya sah',
    (await status('/api/admin/overview', { ...MERCHANT, ...SESSION })) === 404
  );
  check(
    'x-env-override MERCHANT_BO tidak membuka jalan',
    (await status('/api/admin/overview', { ...MERCHANT, ...SESSION, 'x-env-override': 'MERCHANT_BO' })) === 404
  );
  check(
    'host tak dikenal ditolak (gagal tertutup)',
    (await status('/api/admin/overview', { 'x-forwarded-host': 'toko-acak.vercel.app', ...SESSION })) === 404
  );

  console.log('\n3. GATEWAY — header identitas & lingkungan kiriman klien dibuang\n');

  for (const h of ['x-auth-sub', 'x-auth-email', 'x-internal-user', 'x-env-override', 'x-newhope-gateway-token']) {
    check(`gateway membuang ${h} dari kiriman klien`, HEADER_TIDAK_DITERUSKAN.has(h));
  }
  check(
    'x-forwarded-* tetap dibuang lalu diisi ulang gateway',
    ['x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for'].every((h) => HEADER_TIDAK_DITERUSKAN.has(h))
  );

  console.log('\n4. ENUMERASI — daftar staf internal tidak boleh bocor\n');

  check('/api/admin/identities tanpa sesi ditolak', (await status('/api/admin/identities', PROVIDER)) === 404);
  check(
    '/api/admin/identities dari domain merchant ditolak',
    (await status('/api/admin/identities', { ...MERCHANT, ...SESSION })) === 404
  );
  check(
    '/api/admin/identities terbuka untuk SUPERADMIN di PROVIDER_BO',
    (await status('/api/admin/identities', { ...PROVIDER, ...SESSION })) === 200
  );

  console.log(`\n${passed} PASS, ${failed} FAIL`);
  if (failed > 0) process.exitCode = 1;
} catch (err) {
  console.error('\nFATAL:', err.message);
  process.exitCode = 1;
} finally {
  server.close();
}
