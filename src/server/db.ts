/**
 * Lapisan akses database — satu antarmuka, dua driver.
 *
 *   DATABASE_URL diisi   -> `pg`, ke PostgreSQL sungguhan (produksi/staging)
 *   DATABASE_URL kosong  -> PGlite, PostgreSQL 18.3 (WASM) yang menulis ke
 *                           folder ./.pgdata di mesin ini
 *
 * KENAPA BEGINI, bukan langsung `pg` saja:
 *
 * Sampai hari ini aplikasi menyimpan segalanya di localStorage dan di `Map`
 * dalam memori — restart server, data hilang. Memaksa `pg` berarti tidak ada
 * yang bisa menjalankan aplikasi ini tanpa lebih dulu memasang Docker dan
 * menyalakan cluster Postgres. Itu menjadikan "punya database" sesuatu yang
 * ditunda terus.
 *
 * PGlite adalah PostgreSQL asli yang dikompilasi ke WASM — bukan tiruan, bukan
 * SQLite dengan dialek mirip. SQL yang sama, tipe yang sama, plpgsql yang sama.
 * Jadi migrasi yang jalan di sini dijamin jalan di Postgres produksi, dan
 * pindah ke sana nanti cukup mengisi satu variabel lingkungan.
 *
 * BATASNYA, supaya jujur: PGlite satu proses, satu koneksi, tanpa replikasi.
 * Cukup untuk pengembangan dan demo. Untuk produksi dengan banyak merchant
 * berjalan bersamaan, isi DATABASE_URL dan pakai Postgres sungguhan.
 *
 * SATU PENULIS SAJA. PGlite tidak punya server, jadi tidak ada yang menengahi
 * dua proses yang membuka direktori yang sama. Menjalankan `npm run db:seed`
 * saat `npm run dev` menyala membuat keduanya memegang salinan sendiri, dan
 * yang terakhir menulis akan menang secara diam-diam — layar menampilkan angka
 * yang tidak ada di disk. Berkas kunci di bawah mengubah kejadian membingungkan
 * itu menjadi pesan error yang jelas.
 *
 * Batas ini hilang begitu DATABASE_URL diisi: Postgres sungguhan memang
 * dirancang untuk banyak koneksi.
 */

import fs from 'node:fs';
import path from 'node:path';

export type QueryResult<T = any> = { rows: T[]; rowCount: number };

export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /**
   * Menjalankan skrip berisi BANYAK statement sekaligus — khusus file migrasi.
   *
   * `query()` memakai extended query protocol, yang menurut spesifikasi hanya
   * menerima satu statement per pesan; file migrasi berisi puluhan. `exec()`
   * memakai simple query protocol yang menerimanya.
   *
   * Konsekuensinya: exec() TIDAK menerima parameter. Jangan pernah menyusun SQL
   * di sini dari input pengguna — pakai query() dengan $1, $2.
   */
  exec(sql: string): Promise<void>;
  /** Menjalankan fn di dalam satu transaksi; rollback otomatis kalau melempar. */
  tx<T>(fn: (c: Db) => Promise<T>): Promise<T>;
  readonly driver: 'pg' | 'pglite';
  readonly label: string;
}

/* -------------------------------------------------------------------------- */
/* DRIVER: pg                                                                  */
/* -------------------------------------------------------------------------- */

async function createPgDb(connectionString: string): Promise<Db> {
  const { default: pg } = await import('pg');

  // NUMERIC pulang sebagai string dari pg supaya presisi tidak hilang. Untuk
  // rupiah dan skor risiko kita memang mau angka, dan nilainya jauh di bawah
  // batas aman float64 — jadi parse di sini, sekali, bukan di setiap pemanggil.
  pg.types.setTypeParser(1700, (v: string) => (v === null ? null : Number(v)));
  pg.types.setTypeParser(20, (v: string) => (v === null ? null : Number(v))); // int8

  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // Gagal cepat dan berisik kalau URL-nya salah, bukan diam-diam saat request
  // pertama masuk.
  const probe = await pool.connect();
  probe.release();

  const wrap = (runner: { query: (s: string, p?: unknown[]) => Promise<any> }): Db => ({
    driver: 'pg',
    label: 'PostgreSQL (pg)',
    async query(sql, params) {
      const r = await runner.query(sql, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    },
    async exec(sql) {
      // Tanpa argumen params, node-postgres memakai simple query protocol,
      // yang memang menerima banyak statement dalam satu kiriman.
      await runner.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  });

  return wrap(pool);
}

/* -------------------------------------------------------------------------- */
/* DRIVER: PGlite                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Mencegah dua proses membuka direktori PGlite yang sama.
 *
 * Berkas kunci menyimpan PID. Kalau proses pemiliknya sudah mati — laptop
 * hibernasi, Ctrl-C, crash — kuncinya basi dan diambil alih; kunci yatim yang
 * hanya bisa dihapus manual jauh lebih menyebalkan daripada masalah yang
 * dicegahnya.
 */
function acquireLock(dataDir: string): void {
  const lockPath = path.join(dataDir, '.writer.lock');

  if (fs.existsSync(lockPath)) {
    const pid = Number(fs.readFileSync(lockPath, 'utf8').trim());
    let alive = false;
    try {
      // Sinyal 0 tidak mengirim apa pun; hanya menanyakan apakah prosesnya ada.
      process.kill(pid, 0);
      alive = pid !== process.pid;
    } catch {
      alive = false;
    }
    if (alive) {
      throw new Error(
        `Database PGlite di ${dataDir} sedang dipakai proses lain (PID ${pid}).\n` +
          `PGlite hanya boleh punya satu penulis. Hentikan proses itu — biasanya "npm run dev" —\n` +
          `lalu jalankan lagi. Untuk beberapa proses sekaligus, pakai Postgres sungguhan lewat DATABASE_URL.`
      );
    }
  }

  fs.writeFileSync(lockPath, String(process.pid), 'utf8');
  const release = () => {
    try {
      if (fs.readFileSync(lockPath, 'utf8').trim() === String(process.pid)) fs.unlinkSync(lockPath);
    } catch {
      /* sudah hilang; tidak apa-apa */
    }
  };
  process.once('exit', release);
  process.once('SIGINT', () => {
    release();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    release();
    process.exit(143);
  });
}

async function createPgliteDb(dataDir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  fs.mkdirSync(dataDir, { recursive: true });
  acquireLock(dataDir);

  const pglite = new PGlite(dataDir, {
    // Harus sama persis dengan setTypeParser di jalur `pg`. Kalau tidak,
    // NUMERIC pulang sebagai string di sini dan sebagai number di produksi —
    // dan `"181696920.00" + 0` diam-diam menjadi teks, bukan penjumlahan.
    parsers: {
      1700: (v: string) => (v === null ? null : Number(v)), // numeric
      20: (v: string) => (v === null ? null : Number(v)),   // int8
    },
  });
  await pglite.waitReady;

  // PGlite serial — satu koneksi, tidak ada pool. Dua transaksi yang tumpang
  // tindih akan saling merusak, jadi transaksi diantrikan satu per satu.
  let chain: Promise<unknown> = Promise.resolve();

  const base: Db = {
    driver: 'pglite',
    label: `PGlite (PostgreSQL WASM) @ ${path.relative(process.cwd(), dataDir) || dataDir}`,
    async query(sql, params) {
      const r = await pglite.query(sql, params as any[]);
      return { rows: (r.rows as any[]) ?? [], rowCount: r.rows?.length ?? 0 };
    },
    async exec(sql) {
      await pglite.exec(sql);
    },
    async tx(fn) {
      const run = async () => {
        await pglite.exec('BEGIN');
        try {
          const out = await fn(base);
          await pglite.exec('COMMIT');
          return out;
        } catch (err) {
          await pglite.exec('ROLLBACK').catch(() => {});
          throw err;
        }
      };
      const next = chain.then(run, run);
      // Rantai tidak boleh putus gara-gara satu transaksi gagal.
      chain = next.catch(() => {});
      return next as Promise<any>;
    },
  };

  return base;
}

/* -------------------------------------------------------------------------- */
/* MIGRASI                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Urutannya penting dan tidak boleh diurutkan secara alfabet: 0005 mengubah
 * semua primary key menjadi UUID, jadi apa pun yang membuat tabel harus sudah
 * jalan sebelumnya, dan apa pun yang memasang foreign key harus sesudahnya.
 */
const MIGRATIONS = [
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

async function ensureMigrationTable(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(160) PRIMARY KEY,
      applied_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function runMigrations(db: Db, log: (m: string) => void = () => {}): Promise<void> {
  await ensureMigrationTable(db);

  const done = new Set(
    (await db.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
      (r) => r.filename
    )
  );

  for (const file of MIGRATIONS) {
    if (done.has(file)) continue;

    const full = path.join(process.cwd(), file);
    if (!fs.existsSync(full)) {
      log(`  LEWAT  ${file} (tidak ada)`);
      continue;
    }

    const sql = fs.readFileSync(full, 'utf8');
    const t0 = Date.now();
    try {
      // Satu file = satu transaksi. Migrasi yang gagal di tengah tidak boleh
      // meninggalkan skema setengah jadi.
      await db.tx(async (c) => {
        await c.exec(sql);
        await c.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      });
      log(`  OK     ${file} (${Date.now() - t0}ms)`);
    } catch (err) {
      log(`  GAGAL  ${file}: ${(err as Error).message}`);
      throw err;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* SINGLETON                                                                   */
/* -------------------------------------------------------------------------- */

let instance: Db | null = null;
let opening: Promise<Db> | null = null;

export function describeTarget(): string {
  return process.env.DATABASE_URL
    ? 'PostgreSQL via DATABASE_URL'
    : `PGlite lokal (${process.env.PGLITE_DIR || './.pgdata'})`;
}

export async function getDb(log: (m: string) => void = () => {}): Promise<Db> {
  if (instance) return instance;
  if (opening) return opening;

  opening = (async () => {
    const url = (process.env.DATABASE_URL || '').trim();
    const db = url
      ? await createPgDb(url)
      : await createPgliteDb(path.resolve(process.cwd(), process.env.PGLITE_DIR || '.pgdata'));

    log(`🗄️  Database: ${db.label}`);
    await runMigrations(db, log);
    instance = db;
    return db;
  })();

  try {
    return await opening;
  } catch (err) {
    opening = null; // biar percobaan berikutnya tidak memakai promise yang sudah gagal
    throw err;
  }
}
