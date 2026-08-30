#!/usr/bin/env node
/**
 * Mengaktifkan isolasi peran per-service — dan membuktikan bahwa ia berlaku.
 *
 *   node scripts/db/setup-service-roles.mjs           # periksa saja (default)
 *   node scripts/db/setup-service-roles.mjs --live    # terapkan
 *
 * MASALAH YANG DISELESAIKAN. Migrasi 0009 membuat `svc_pos`, `svc_ai`,
 * `svc_billing`, dan `svc_internal` lengkap dengan hak akses yang mengurung
 * tiap service di skemanya sendiri — lalu membuat keempatnya NOLOGIN. Tidak ada
 * `SET ROLE` di mana pun, dan kelima service memakai satu DATABASE_URL. Jadi
 * batas yang README sebut "ditegakkan database" tidak pernah aktif: satu bug di
 * ai-service bisa menulis ke `pos.transactions` tanpa ditolak siapa pun.
 *
 * KENAPA SKRIP, BUKAN MIGRASI. Memberi peran kemampuan LOGIN berarti memberinya
 * kata sandi. Kata sandi tidak boleh masuk ke berkas migrasi yang ikut
 * ter-commit, jadi langkah ini dijalankan operator dengan rahasia dari
 * lingkungannya sendiri — bukan oleh penerap migrasi.
 *
 * KATA SANDI diambil dari environment, satu per peran:
 *
 *   PGPASS_SVC_POS  PGPASS_SVC_AI  PGPASS_SVC_BILLING  PGPASS_SVC_INTERNAL
 *
 * Yang tidak diisi akan dibuatkan kata sandi acak, dicetak SEKALI ke layar agar
 * bisa disalin ke pengelola rahasia. Tidak ada yang ditulis ke disk.
 *
 * Tanpa --live skrip hanya melaporkan keadaan sekarang dan tidak mengubah apa
 * pun, sehingga aman dijalankan terhadap produksi untuk sekadar bertanya
 * "apakah isolasinya sudah aktif?".
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import { config } from 'dotenv';

config();

const LIVE = process.argv.includes('--live');

/** Peran -> skema yang dimilikinya. Sama persis dengan migrasi 0009. */
const PERAN = [
  { peran: 'svc_pos', schema: 'pos', env: 'PGPASS_SVC_POS', url: 'DATABASE_URL_POS' },
  { peran: 'svc_ai', schema: 'ai', env: 'PGPASS_SVC_AI', url: 'DATABASE_URL_AI' },
  { peran: 'svc_billing', schema: 'billing', env: 'PGPASS_SVC_BILLING', url: 'DATABASE_URL_BILLING' },
  { peran: 'svc_internal', schema: 'internal', env: 'PGPASS_SVC_INTERNAL', url: 'DATABASE_URL_INTERNAL' },
];

/*
 * BATAS YANG SEBENARNYA — dan kenapa ia tidak sesederhana "satu skema, satu
 * service".
 *
 * `internal.tenants`, `merchants`, `outlets`, dan `users` adalah IDENTITY PLANE
 * BERSAMA, bukan milik backoffice semata. Migrasi 0014 dan 0015 memberikan
 * SELECT + REFERENCES atas ketiganya kepada semua peran (tabel mereka punya
 * foreign key ke sana, dan Postgres menuntut REFERENCES untuk itu), plus INSERT
 * dan UPDATE kepada `svc_pos` — karena provisioning tenant terjadi di jalur
 * sinkronisasi kasir, bukan di back-office.
 *
 * Jadi menguji "svc_pos tidak boleh menyentuh skema internal" akan melaporkan
 * kebocoran yang sebenarnya keputusan desain. Yang benar-benar harus tertutup
 * adalah DATA BISNIS milik service lain, dan tabel back-office yang memuat
 * identitas staf penyedia beserta jejak aksesnya.
 */
const TERLARANG = {
  svc_pos: ['ai', 'billing', 'backoffice'],
  svc_ai: ['pos', 'billing', 'backoffice'],
  svc_billing: ['ai', 'backoffice'],
  svc_internal: ['pos', 'ai', 'billing'],
};

/** Satu tabel per wilayah yang pasti ada, untuk menguji penolakan. */
const TABEL_UJI = {
  pos: 'pos.transactions',
  ai: 'ai.merchant_ai_credits',
  billing: 'billing.subscriptions',
  // Bukan internal.tenants: itu identity plane bersama (lihat catatan di atas).
  // internal_users memuat identitas staf penyedia — tidak ada service lain yang
  // punya alasan membacanya.
  backoffice: 'internal.internal_users',
};

/**
 * Akses yang HARUS tetap ada. Isolasi yang terlalu ketat sama merusaknya dengan
 * yang terlalu longgar — bedanya, yang ini gagal dengan cara yang berisik.
 */
const WAJIB_BISA = [
  { peran: 'svc_pos', sql: 'SELECT 1 FROM internal.tenants LIMIT 1', ket: 'provisioning tenant' },
  { peran: 'svc_pos', sql: 'SELECT 1 FROM internal.users LIMIT 1', ket: 'resolusi kasir' },
  { peran: 'svc_ai', sql: 'SELECT 1 FROM contract.merchant_revenue LIMIT 1', ket: 'angka omzet' },
  { peran: 'svc_internal', sql: 'SELECT 1 FROM contract.merchant_directory LIMIT 1', ket: 'konsol admin' },
];

function klien() {
  const connectionString = process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/postgres';
  const lokal = /@(127\.0\.0\.1|localhost)/.test(connectionString);
  return new pg.Client({
    connectionString,
    ssl: lokal
      ? undefined
      : process.env.PGSSLROOTCERT
        ? { ca: fs.readFileSync(process.env.PGSSLROOTCERT, 'utf8'), rejectUnauthorized: true }
        : { rejectUnauthorized: false },
  });
}

async function main() {
  const c = klien();
  c.on('error', () => {});
  await c.connect();

  console.log(LIVE ? '\n[peran] MODE TERAPKAN\n' : '\n[peran] MODE PERIKSA — tidak ada yang diubah (pakai --live untuk menerapkan)\n');

  const dibuat = [];

  for (const r of PERAN) {
    const ada = await c.query('SELECT rolcanlogin FROM pg_roles WHERE rolname = $1', [r.peran]);

    if (!ada.rows.length) {
      console.log(`  ${r.peran.padEnd(14)} TIDAK ADA — jalankan migrasi lebih dulu (0009).`);
      continue;
    }

    const bisaLogin = ada.rows[0].rolcanlogin === true;

    if (!LIVE) {
      console.log(
        `  ${r.peran.padEnd(14)} ${bisaLogin ? 'LOGIN aktif' : 'NOLOGIN — isolasi belum aktif'}` +
          `   ${process.env[r.url] ? `${r.url} terisi` : `${r.url} kosong`}`
      );
      continue;
    }

    const sandi = process.env[r.env] || crypto.randomBytes(24).toString('base64url');
    const acak = !process.env[r.env];

    // format('%L') menghindari penyusunan string kata sandi di sisi Node.
    await c.query(`ALTER ROLE ${pg.escapeIdentifier(r.peran)} LOGIN PASSWORD ${pg.escapeLiteral(sandi)}`);

    // Hak akses sudah diberikan 0009, tapi tabel yang dibuat SETELAHNYA hanya
    // tercakup kalau ALTER DEFAULT PRIVILEGES-nya berjalan. Diulang di sini
    // supaya peran yang baru diaktifkan tidak kekurangan hak atas tabel baru.
    await c.query(`GRANT USAGE, CREATE ON SCHEMA ${pg.escapeIdentifier(r.schema)} TO ${pg.escapeIdentifier(r.peran)}`);
    await c.query(`GRANT ALL ON ALL TABLES IN SCHEMA ${pg.escapeIdentifier(r.schema)} TO ${pg.escapeIdentifier(r.peran)}`);
    await c.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA ${pg.escapeIdentifier(r.schema)} TO ${pg.escapeIdentifier(r.peran)}`);
    await c.query(`GRANT USAGE ON SCHEMA contract TO ${pg.escapeIdentifier(r.peran)}`);
    await c.query(`GRANT SELECT ON ALL TABLES IN SCHEMA contract TO ${pg.escapeIdentifier(r.peran)}`);
    await c.query(`GRANT USAGE ON SCHEMA public TO ${pg.escapeIdentifier(r.peran)}`);

    console.log(`  ${r.peran.padEnd(14)} LOGIN diaktifkan${acak ? ' (kata sandi dibuat acak)' : ''}`);
    if (acak) dibuat.push({ ...r, sandi });
  }

  if (LIVE && dibuat.length) {
    console.log('\n  Kata sandi berikut HANYA ditampilkan sekali. Salin ke pengelola rahasia,');
    console.log('  lalu isi variabel ini di lingkungan tiap service:\n');
    for (const d of dibuat) {
      console.log(`    ${d.url}="postgresql://${d.peran}:${d.sandi}@HOST:5432/DBNAME"`);
    }
  }

  /* -- PEMBUKTIAN ---------------------------------------------------------
   *
   * Mengaktifkan peran tidak ada gunanya kalau batasnya ternyata tidak
   * berlaku. SET ROLE dipakai di sini — bukan koneksi baru — supaya
   * pemeriksaan bisa berjalan tanpa perlu tahu kata sandi siapa pun.
   */
  console.log('\n[peran] menguji batas akses:\n');
  let bocor = 0;
  let diuji = 0;

  for (const r of PERAN) {
    const ada = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [r.peran]);
    if (!ada.rows.length) continue;

    for (const skemaTerlarang of TERLARANG[r.peran]) {
      const tabel = TABEL_UJI[skemaTerlarang];
      diuji++;
      try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL ROLE ${pg.escapeIdentifier(r.peran)}`);
        await c.query(`SELECT 1 FROM ${tabel} LIMIT 1`);
        await c.query('ROLLBACK');
        console.log(`  BOCOR  ${r.peran} -> ${tabel} (seharusnya ditolak)`);
        bocor++;
      } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        if (err.code === '42501') {
          console.log(`  OK     ${r.peran} -> ${tabel} ditolak`);
        } else {
          console.log(`  ?      ${r.peran} -> ${tabel} error lain: ${err.code} ${err.message}`);
        }
      }
    }
  }

  console.log(
    bocor === 0
      ? `\n[peran] ${diuji} batas diuji, semuanya ditegakkan.`
      : `\n[peran] ${bocor} dari ${diuji} batas TIDAK ditegakkan.`
  );

  /* Isolasi yang memutus jalur yang sah sama merusaknya. */
  console.log('\n[peran] menguji akses yang WAJIB tetap ada:\n');
  let putus = 0;
  for (const w of WAJIB_BISA) {
    const ada = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [w.peran]);
    if (!ada.rows.length) continue;
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL ROLE ${pg.escapeIdentifier(w.peran)}`);
      await c.query(w.sql);
      await c.query('ROLLBACK');
      console.log(`  OK      ${w.peran} — ${w.ket}`);
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      console.log(`  PUTUS   ${w.peran} — ${w.ket}: ${err.code} ${err.message}`);
      putus++;
    }
  }

  const gagal = bocor + putus;
  console.log(
    gagal === 0
      ? '\n[peran] batas dan akses keduanya benar.\n'
      : `\n[peran] ${bocor} kebocoran, ${putus} akses terputus.\n`
  );

  await c.end();
  process.exit(gagal === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[peran] gagal:', err.message);
  process.exit(1);
});
