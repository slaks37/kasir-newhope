/**
 * Klien database untuk service.
 *
 * Berbeda dari src/server/db.ts yang bisa menjalankan PGlite di dalam proses:
 * service SELALU terhubung lewat jaringan ke Postgres sungguhan. Di
 * pengembangan itu adalah pglite-server (PGlite yang berbicara protokol wire
 * Postgres), di produksi Postgres asli. Kodenya tidak tahu bedanya, dan memang
 * tidak perlu tahu.
 *
 * BATAS SKEMA. Setiap service login sebagai perannya sendiri dengan search_path
 * yang hanya memuat skema miliknya dan `contract`. Menyentuh tabel service lain
 * bukan gagal saat code review — gagal di Postgres, dengan pesan yang jelas.
 */

import fs from 'node:fs';
import pg from 'pg';

// NUMERIC pulang sebagai string agar presisi tidak hilang. Untuk rupiah dan
// skor risiko kita memang mau angka, dan nilainya jauh di bawah batas aman
// float64 — jadi parse sekali di sini, bukan di setiap pemanggil.
pg.types.setTypeParser(1700, (v: string) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v: string) => (v === null ? null : Number(v)));

export type QueryResult<T = any> = { rows: T[]; rowCount: number };

export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (c: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface DbOptions {
  /** Skema milik service ini. Diletakkan pertama di search_path. */
  schema: string;
  connectionString?: string;
  max?: number;
}


/**
 * Konfigurasi SSL.
 *
 * Layanan terkelola (Supabase, RDS, Neon, Cloud SQL) MEWAJIBKAN TLS dan menolak
 * koneksi polos. `pg` tidak menyalakan TLS hanya karena URL-nya jarak jauh —
 * harus diminta eksplisit, kalau tidak koneksinya ditolak dengan pesan yang
 * tidak menyebut SSL sama sekali.
 *
 * rejectUnauthorized:false dipakai karena Supabase memakai rantai sertifikat
 * yang tidak selalu ada di trust store Node. Itu berarti koneksinya TERENKRIPSI
 * tapi tidak memverifikasi identitas server. Untuk beban produksi sungguhan,
 * unduh CA Supabase dan setel PGSSLROOTCERT — lalu hapus baris ini.
 */
function konfigurasiSsl(connectionString: string) {
  const url = connectionString.toLowerCase();
  const lokal =
    url.includes('@127.0.0.1') || url.includes('@localhost') || url.includes('sslmode=disable');
  if (lokal) return undefined;

  if (process.env.PGSSLROOTCERT) {
    return { ca: fs.readFileSync(process.env.PGSSLROOTCERT, 'utf8'), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

/**
 * Kredensial untuk satu service.
 *
 * KENAPA INI ADA. Migrasi 0009 membuat peran `svc_pos`, `svc_ai`, `svc_billing`,
 * dan `svc_internal`, lengkap dengan hak akses yang mengurung tiap service di
 * skemanya sendiri. Tapi keempatnya dibuat NOLOGIN, tidak ada satu pun `SET
 * ROLE` di seluruh basis kode, dan fungsi ini dulu selalu memakai satu
 * `DATABASE_URL`. Artinya isolasi yang dijanjikan README ada di DDL tapi TIDAK
 * PERNAH AKTIF saat sistem berjalan: kelima proses berbagi satu identitas
 * dengan hak penuh atas kelima skema.
 *
 * Sekarang tiap service mencari kredensialnya sendiri lebih dulu:
 *
 *   DATABASE_URL_POS, DATABASE_URL_AI, DATABASE_URL_BILLING, DATABASE_URL_INTERNAL
 *
 * dan jatuh ke `DATABASE_URL` kalau tidak ada. Cadangan itu disengaja — tanpa
 * itu, setiap pemasangan yang sudah ada berhenti bekerja begitu berkas ini
 * diperbarui, dan perubahan keamanan yang memaksa downtime cenderung ditunda
 * atau dibatalkan.
 *
 * Mengaktifkan isolasinya: `node scripts/db/setup-service-roles.mjs --live`,
 * lalu isi keempat variabel di atas. Verifikasinya ada di skrip yang sama.
 */
function kredensialService(schema: string): { url: string; peran: boolean } {
  const khusus = (process.env[`DATABASE_URL_${schema.toUpperCase()}`] || '').trim();
  if (khusus) return { url: khusus, peran: true };
  return {
    url: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/postgres',
    peran: false,
  };
}

export async function connectDb(opts: DbOptions): Promise<Db> {
  const dipilih = kredensialService(opts.schema);
  const connectionString = opts.connectionString || dipilih.url;

  if (!opts.connectionString) {
    // Nama peran saja, tidak pernah URL-nya: URL memuat kata sandi.
    console.log(
      dipilih.peran
        ? `[db] skema ${opts.schema}: memakai peran khusus (DATABASE_URL_${opts.schema.toUpperCase()})`
        : `[db] skema ${opts.schema}: memakai DATABASE_URL bersama — isolasi peran TIDAK aktif`
    );
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: konfigurasiSsl(connectionString),
    // Kecil dengan sengaja. Di pengembangan, keempat service berbagi satu
    // batas koneksi di db-server; pool besar per service akan menghabiskannya
    // dan membuat service yang menyala terakhir gagal tersambung.
    max: opts.max ?? Number(process.env.PGPOOL_MAX || 4),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  /*
   * TIDAK ADA `SET search_path` DI SINI. Setiap query WAJIB menyebut skemanya
   * sendiri: `pos.transactions`, `ai.merchant_targets`, `contract.catalog`.
   *
   * Dua alasan, dan yang kedua ditemukan dengan cara yang mahal:
   *
   * 1. Handler 'connect' milik node-postgres tidak ditunggu. Query pertama pada
   *    koneksi baru bisa berjalan sebelum SET selesai — gagal secara acak, dan
   *    hanya saat pool sedang tumbuh.
   *
   * 2. Lebih menentukan: pglite-server memultipleks semua koneksi ke SATU
   *    instance PGlite, sehingga `SET` bersifat GLOBAL. Diuji langsung —
   *    koneksi baru mewarisi search_path yang disetel service lain. Empat
   *    service akan saling menimpa, dan tabel yang "hilang" berpindah-pindah
   *    tergantung siapa yang menyetel terakhir.
   *
   * Penyebutan skema secara eksplisit juga membuat batas kepemilikan terbaca
   * langsung dari query, bukan tersembunyi di konfigurasi koneksi.
   */
  void opts.schema;

  // Koneksi yang mati di dalam pool tidak boleh menjatuhkan proses.
  pool.on('error', (err) => {
    console.error('[db] koneksi idle bermasalah:', err.message);
  });

  await withRetry(async () => {
    const probe = await pool.connect();
    probe.release();
  });

  const wrap = (runner: { query: (s: string, p?: unknown[]) => Promise<any> }): Db => ({
    async query(sql, params) {
      const r = await runner.query(sql, params as any[]);
      const rows = r?.rows ?? [];
      return { rows, rowCount: r?.rowCount ?? rows.length };
    },
    async exec(sql) {
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
    async close() {
      await pool.end();
    },
  });

  return wrap(pool);
}

/**
 * Menunggu database siap.
 *
 * Service dan database menyala bersamaan. Tanpa percobaan ulang, service yang
 * kebetulan lebih cepat akan mati saat boot dan orkestrator harus
 * menghidupkannya lagi — riuh, lambat, dan terlihat seperti kegagalan padahal
 * hanya soal urutan.
 */
async function withRetry(fn: () => Promise<void>, attempts = 15): Promise<void> {
  let lastErr: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err as Error;
      const wait = Math.min(250 * 2 ** i, 3000);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`Database tidak bisa dihubungi setelah ${attempts} percobaan: ${lastErr?.message}`);
}
