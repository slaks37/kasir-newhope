/**
 * Penerap migrasi untuk arsitektur service.
 *
 * Berjalan sebagai proses tersendiri, bukan di dalam service mana pun. Alasannya
 * menentukan: kalau tiap service menerapkan migrasi saat boot, lima proses akan
 * berlomba mengubah skema yang sama saat dinyalakan bersamaan — dan yang kalah
 * akan gagal dengan error yang membingungkan. Migrasi dijalankan sekali,
 * sebelum service manapun menyala.
 *
 *   npx tsx services/db-server/migrate.ts
 */

import '../shared/env';
import { ringkasTujuanDb, ringkasEnv } from '../shared/env';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

/*
 * Urutan penerapan.
 *
 * Sebelas berkas pertama disebut EKSPLISIT karena urutannya tidak bisa
 * diturunkan dari nama: `schema.sql` dan `schema_hybrid_pos.sql` tidak
 * bernomor, tapi harus berjalan setelah penambal kompatibilitas dan sebelum
 * migrasi bernomor mana pun. Sisanya ditemukan otomatis supaya migrasi baru
 * cukup dijatuhkan ke `migrations/` tanpa menyunting berkas ini.
 *
 * DEDUPLIKASI WAJIB. Penemuan otomatis ikut mengembalikan 0003-0010 yang sudah
 * disebut eksplisit di atas, sehingga daftarnya memuat delapan entri kembar.
 * Tanpa `dedupe`, kedelapan berkas itu diterapkan DUA KALI pada database yang
 * masih kosong — dan yang kedua gagal:
 *
 *   GAGAL migrations/0003_smart_assistant.sql:
 *         function name "consume_ai_credit" is not unique
 *
 * Penyebabnya 0010 sudah menambahkan varian UUID dari fungsi itu, jadi
 * pemanggilan tanpa tipe di 0003 menjadi ambigu saat diulang. Akibatnya
 * `npm run dev` pada checkout bersih berhenti di tengah — kegagalan yang hanya
 * muncul pada database baru, sehingga tidak pernah terlihat oleh siapa pun yang
 * `.pgdata`-nya sudah terisi.
 */
function dedupe(files: string[]): string[] {
  const seen = new Set<string>();
  return files.filter((file) => (seen.has(file) ? false : (seen.add(file), true)));
}

const MIGRATIONS = dedupe([
  // Penambal versi PostgreSQL — WAJIB paling awal. Menyediakan uuidv7() di
  // PostgreSQL < 18 (Supabase, RDS, Cloud SQL umumnya masih 15-17).
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
  ...fs.readdirSync(path.join(process.cwd(), 'migrations'))
    .filter((file) => /^\d{4}_.*\.sql$/.test(file) && file !== '0001_compat.sql')
    .sort()
    .map((file) => `migrations/${file}`),
]);

async function main() {
  console.log(`[migrate] ${ringkasEnv()}`);
  const connectionString =
    process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/postgres';

  // Database dan migrator sering dinyalakan bersamaan, jadi percobaan pertama
  // biasanya gagal. KLIEN BARU SETIAP PERCOBAAN: pg.Client tidak bisa dipakai
  // ulang setelah connect() gagal — percobaan kedua pada objek yang sama
  // ditolak dengan "Client has already been connected", dan pesan itu
  // menyesatkan karena seolah-olah koneksinya berhasil.
  let client!: pg.Client;
  for (let i = 0; ; i++) {
    // SSL wajib untuk layanan terkelola; dilewati untuk database lokal.
    const lokal = /@(127\.0\.0\.1|localhost)/.test(connectionString);
    client = new pg.Client({
      connectionString,
      ssl: lokal
        ? undefined
        : process.env.PGSSLROOTCERT
          ? { ca: fs.readFileSync(process.env.PGSSLROOTCERT, 'utf8'), rejectUnauthorized: true }
          : { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      break;
    } catch (err) {
      await client.end().catch(() => {});
      if (i >= 20) throw err;
      await new Promise((r) => setTimeout(r, Math.min(250 * 2 ** i, 2000)));
    }
  }

  console.log(`[migrate] tersambung: ${ringkasTujuanDb()}`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename    VARCHAR(160) PRIMARY KEY,
      applied_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const done = new Set(
    (await client.query('SELECT filename FROM public.schema_migrations')).rows.map(
      (r: any) => r.filename
    )
  );

  let applied = 0;
  for (const file of MIGRATIONS) {
    if (done.has(file)) continue;

    const full = path.join(process.cwd(), file);
    if (!fs.existsSync(full)) {
      console.log(`  LEWAT  ${file} (tidak ada)`);
      continue;
    }

    const sql = fs.readFileSync(full, 'utf8');
    const t0 = Date.now();
    try {
      // Satu file, satu transaksi. Migrasi yang gagal di tengah tidak boleh
      // meninggalkan skema setengah jadi.
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO public.schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      // `done` diisi sekali sebelum loop, jadi tanpa baris ini ia tidak tahu
      // apa yang baru saja diterapkan pada jalannya sendiri. Deduplikasi di
      // atas sudah cukup hari ini; ini menjaga entri kembar berikutnya tetap
      // tidak berbahaya.
      done.add(file);
      console.log(`  OK     ${file} (${Date.now() - t0}ms)`);
      applied++;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`  GAGAL  ${file}: ${(err as Error).message}`);
      await client.end();
      process.exit(1);
    }
  }

  console.log(applied === 0 ? '[migrate] tidak ada yang baru.' : `[migrate] ${applied} migrasi diterapkan.`);

  // Ringkasan skema — bukti bahwa pemisahannya benar-benar terjadi.
  const s = await client.query(`
    SELECT table_schema, COUNT(*)::int AS n
      FROM information_schema.tables
     WHERE table_schema IN ('pos','billing','ai','internal','contract','public')
       AND table_type = 'BASE TABLE'
     GROUP BY table_schema ORDER BY 1
  `);
  const v = await client.query(`
    SELECT COUNT(*)::int AS n FROM information_schema.views WHERE table_schema = 'contract'
  `);
  console.log('[migrate] tabel per skema:', s.rows.map((r: any) => `${r.table_schema}=${r.n}`).join(' '));
  console.log(`[migrate] view kontrak: ${v.rows[0].n}`);

  await client.end();
}

main().catch((err) => {
  console.error('[migrate] gagal:', err.message);
  process.exit(1);
});
