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

const MIGRATIONS = [
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
  'migrations/0011_identity_grants.sql',
  'migrations/0012_customers.sql',
  'migrations/0013_merchant_tenant_invariant.sql',
  'migrations/0014_plan_entitlements.sql',
  'migrations/0015_admin_auth.sql',
  'migrations/0016_merchant_entitlements.sql',
  'migrations/0017_stock_contract_views.sql',
  'migrations/0018_bundles.sql',
  'migrations/0019_drop_tenant_id_duplikat.sql',
  'migrations/0020_branches.sql',
  'migrations/0021_doku_pembayaran.sql',
  'migrations/0022_empat_tier.sql',
  'migrations/0023_entitlement_kedaluwarsa.sql',
  'migrations/0024_trial_otomatis.sql',
  'migrations/0025_hierarki_identitas.sql',
  'migrations/0026_event_dan_ledger.sql',
  'migrations/0027_kredit_ai_ledger.sql',
  'migrations/0028_langganan_per_merchant.sql',
  'migrations/0029_kredit_yatim.sql',
  'migrations/0030_mrr_dipisah.sql',
  'migrations/0031_blog_publik.sql',
  'migrations/0032_kepemilikan_ditegakkan.sql',
  'migrations/0033_identitas_staf.sql',
];

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
