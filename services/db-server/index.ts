/**
 * Server database untuk pengembangan.
 *
 * Menyajikan PGlite lewat protokol wire PostgreSQL, sehingga kelima service
 * bisa terhubung dengan driver `pg` biasa — koneksi terpisah, proses terpisah,
 * persis seperti menghadapi Postgres sungguhan.
 *
 * KENAPA PERLU. PGlite berjalan di dalam proses dan hanya boleh punya satu
 * penulis. Arsitektur lima service jelas melanggar itu. Tanpa lapisan ini,
 * satu-satunya cara menjalankan sistem secara lokal adalah memasang Docker dan
 * Postgres — dan arsitektur yang tidak bisa dijalankan tanpa persiapan
 * setengah jam adalah arsitektur yang jarang diuji.
 *
 * DI PRODUKSI, HAPUS INI. Isi DATABASE_URL dengan Postgres sungguhan dan
 * jangan jalankan proses ini. Tidak ada kode service yang perlu diubah: mereka
 * memang tidak pernah tahu sedang bicara dengan apa.
 *
 *   npx tsx services/db-server/index.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PGLITE_PORT || 5432);
const DATA_DIR = path.resolve(process.cwd(), process.env.PGLITE_DIR || '.pgdata');

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new PGlite(DATA_DIR, {
    // Harus sama persis dengan setTypeParser di services/shared/db.ts, kalau
    // tidak NUMERIC pulang sebagai string di satu jalur dan angka di jalur lain.
    parsers: {
      1700: (v: string) => (v === null ? null : Number(v)),
      20: (v: string) => (v === null ? null : Number(v)),
    },
  });
  await db.waitReady;

  /*
   * maxConnections defaultnya 1, dan itu masuk akal untuk PGlite — mesinnya
   * memang satu utas. Tapi empat service masing-masing memegang pool, dan
   * dengan batas 1 hanya service pertama yang tersambung; sisanya menerima
   * ECONNRESET yang terbaca seperti database mati padahal database sehat.
   *
   * Query tetap diantrikan satu per satu di dalam; yang bertambah hanyalah
   * jumlah koneksi yang boleh menganggur. Itu sebabnya pool tiap service
   * dibatasi kecil (PGPOOL_MAX) — batas ini dibagi bersama.
   */
  const maxConnections = Number(process.env.PGLITE_MAX_CONN || 24);

  const server = new PGLiteSocketServer({
    db,
    port: PORT,
    host: '127.0.0.1',
    maxConnections,
  });
  await server.start();

  console.log(`[db-server] PostgreSQL (PGlite) di 127.0.0.1:${PORT}`);
  console.log(`[db-server] data: ${path.relative(process.cwd(), DATA_DIR)}`);
  console.log('[db-server] PERINGATAN: hanya untuk pengembangan. Di produksi pakai Postgres sungguhan.');

  const stop = async () => {
    console.log('\n[db-server] menutup…');
    try {
      await server.stop();
      await db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((err) => {
  console.error('[db-server] gagal:', err.message);
  process.exit(1);
});
