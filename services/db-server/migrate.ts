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
import { applyAtomicMigration } from './atomicMigration';
import {databaseTransport} from '../shared/databaseTls';
import {migrationConnection, assertMigrationBaseline} from './migrationSafety';

const MIGRATIONS = [
  // Penambal versi PostgreSQL — WAJIB paling awal. Menyediakan uuidv7() di
  // PostgreSQL < 18 (Supabase, RDS, Cloud SQL umumnya masih 15-17).
  'migrations/0001_compat.sql',
  'schema.sql',
  'schema_hybrid_pos.sql',
  ...fs.readdirSync(path.join(process.cwd(), 'migrations'))
    .filter((file) => /^\d{4}_.*\.sql$/.test(file) && file !== '0001_compat.sql')
    .sort()
    .map((file) => `migrations/${file}`),
  // SQL artifacts already applied through Supabase migration history.
  'docs/security/free-plan-selection.sql',
  'docs/security/free-plan-ai-credit-access.sql',
  'docs/security/restrict-browser-rls-policies.sql',
  'docs/security/intelligence-cache.sql',
  'docs/security/intelligence-wallet.sql',
  ...fs.readdirSync(path.join(process.cwd(),'supabase/migrations')).filter(file=>file.endsWith('_business_scoped_operational_state.sql')).sort().map(file=>'supabase/migrations/'+file),
];

async function main() {
  console.log(`[migrate] ${ringkasEnv()}`);
  const connectionString = migrationConnection(); // Validate before connecting or DDL.

  // Database dan migrator sering dinyalakan bersamaan, jadi percobaan pertama
  // biasanya gagal. KLIEN BARU SETIAP PERCOBAAN: pg.Client tidak bisa dipakai
  // ulang setelah connect() gagal — percobaan kedua pada objek yang sama
  // ditolak dengan "Client has already been connected", dan pesan itu
  // menyesatkan karena seolah-olah koneksinya berhasil.
  let client!: pg.Client;
  for (let i = 0; ; i++) {
    client = new pg.Client({
      ...databaseTransport(connectionString),
      connectionTimeoutMillis: 10_000,
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

  console.log(`[migrate] tersambung: ${ringkasTujuanDb(connectionString)}`);

  // Inspect first: even creating the registry would mutate an unreviewed import.
  const populated = (await client.query(`SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('pos','billing','internal','ai') AND c.relkind IN ('r','p')
  ) AS populated`)).rows[0].populated;
  const registry = (await client.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present")).rows[0].present;
  const existing = new Set<string>(registry
    ? (await client.query('SELECT filename FROM public.schema_migrations')).rows.map(r => r.filename) : []);
  const incrementalLocal = ['localhost','127.0.0.1','[::1]'].includes(new URL(connectionString).hostname);
  try { assertMigrationBaseline(MIGRATIONS, existing, populated, incrementalLocal); }
  catch (error) { await client.end(); throw error; }

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
      await client.end();
      throw Error(`MIGRATION_FILE_MISSING: ${file}`);
    }

    const sql = fs.readFileSync(full, 'utf8');
    const t0 = Date.now();
    try {
      // Satu file, satu transaksi. Migrasi yang gagal di tengah tidak boleh
      // meninggalkan skema setengah jadi.
      await applyAtomicMigration(client, file, sql);
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
