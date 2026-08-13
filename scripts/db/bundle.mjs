/**
 * Menggabungkan seluruh migrasi menjadi SATU berkas SQL.
 *
 *   node scripts/db/bundle.mjs        -> tulis ke supabase-setup.sql
 *
 * KENAPA INI ADA. Menjalankan `npm run db:migrate` butuh kata sandi database di
 * `DATABASE_URL`. Berkas hasil skrip ini bisa ditempel langsung ke SQL Editor
 * Supabase — kata sandinya tidak pernah berpindah tangan, tidak pernah ditulis
 * di berkas mana pun, dan tidak pernah masuk riwayat percakapan.
 *
 * Isinya persis sama dengan yang dijalankan `db:migrate`, dalam urutan yang
 * sama, ditambah pencatatan ke `schema_migrations` agar `db:migrate` nanti tahu
 * mana yang sudah diterapkan dan tidak mengulanginya.
 */

import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
  'migrations/0001_compat.sql',
  'schema.sql',
  'schema_hybrid_pos.sql',
  'migrations/0003_smart_assistant.sql',
  'migrations/0004_internal_backoffice.sql',
  'migrations/0005_uuid_keys.sql',
  'migrations/0006_merchant_activity.sql',
  'migrations/0007_product_description.sql',
  'migrations/0008_catalog_and_charges.sql',
  'migrations/0009_service_schemas.sql',
  'migrations/0010_credit_uuid.sql',
  'migrations/0011_identity_grants.sql',
];

const KELUARAN = process.argv[2] || 'supabase-setup.sql';

const kepala = `-- =============================================================================
-- New Hope POS — penyiapan database lengkap
--
-- Dihasilkan oleh scripts/db/bundle.mjs. JANGAN disunting langsung; ubah berkas
-- migrasi aslinya lalu jalankan ulang skripnya.
--
-- -----------------------------------------------------------------------------
-- CARA PAKAI DI SUPABASE
-- -----------------------------------------------------------------------------
--   1. Dashboard > SQL Editor > New query
--   2. Tempel SELURUH isi berkas ini
--   3. Run
--
-- Perlu 10-30 detik. Setelah selesai, pilih skema "pos" di Table Editor —
-- skema "public" memang akan tetap kosong, karena semua tabel tinggal di
-- skema per-domain (pos, billing, ai, internal) dan itu memang desainnya.
--
-- -----------------------------------------------------------------------------
-- AMAN DIULANG
-- -----------------------------------------------------------------------------
-- Setiap migrasi idempoten dan pencatatannya memakai ON CONFLICT DO NOTHING,
-- jadi menjalankan berkas ini dua kali tidak merusak apa pun.
--
-- -----------------------------------------------------------------------------
-- CATATAN UNTUK POSTGRESQL < 18 (Supabase saat ini 15-17)
-- -----------------------------------------------------------------------------
-- Bagian 0001 memasang uuidv7() versi plpgsql karena fungsi itu baru bawaan di
-- PostgreSQL 18. Kalau nanti Supabase naik ke 18, penambalnya otomatis
-- dilewati dan implementasi bawaan yang dipakai.
--
-- Beberapa perintah butuh hak yang tidak dimiliki peran \`postgres\` di Supabase
-- (mis. ALTER DATABASE ... SET search_path). Semuanya sudah dibungkus
-- penangkap error, jadi akan muncul sebagai NOTICE — bukan kegagalan.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename    VARCHAR(160) PRIMARY KEY,
    applied_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

`;

let keluar = kepala;
let jumlah = 0;

for (const berkas of MIGRATIONS) {
  const penuh = path.join(process.cwd(), berkas);
  if (!fs.existsSync(penuh)) {
    console.error(`  LEWAT  ${berkas} (tidak ada)`);
    continue;
  }

  const sql = fs.readFileSync(penuh, 'utf8');
  const garis = '-'.repeat(74);

  keluar += `\n\n-- ${garis}\n-- BAGIAN ${String(++jumlah).padStart(2, '0')}: ${berkas}\n-- ${garis}\n\n`;
  keluar += sql.trimEnd();
  keluar += `\n\nINSERT INTO public.schema_migrations (filename) VALUES ('${berkas}')\n  ON CONFLICT (filename) DO NOTHING;\n`;

  console.log(`  ${String(jumlah).padStart(2)}. ${berkas}  (${sql.split('\n').length} baris)`);
}

keluar += `\n\n-- ${'='.repeat(74)}\n-- SELESAI. Verifikasi dengan:\n--\n--   SELECT table_schema, COUNT(*) FROM information_schema.tables\n--    WHERE table_schema IN ('pos','billing','ai','internal','contract')\n--      AND table_type = 'BASE TABLE'\n--    GROUP BY table_schema ORDER BY 1;\n--\n-- Harusnya: ai=5  billing=4  internal=4  pos=10\n-- ${'='.repeat(74)}\n`;

fs.writeFileSync(KELUARAN, keluar, 'utf8');

const kb = (Buffer.byteLength(keluar, 'utf8') / 1024).toFixed(1);
console.log(`\n${jumlah} migrasi digabung -> ${KELUARAN} (${kb} KB, ${keluar.split('\n').length} baris)`);
