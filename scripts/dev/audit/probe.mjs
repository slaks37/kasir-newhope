/**
 * Perkakas bersama untuk seluruh probe kesiapan produksi.
 *
 * TUJUAN SAMBUNGAN DIBACA DARI LINGKUNGAN, BUKAN DI-HARDCODE.
 *
 * Versi pertama berkas ini menuliskan `postgres://postgres@127.0.0.1:5432/postgres`
 * apa adanya. Akibatnya probe hanya bisa berjalan terhadap PGlite di mesin
 * pengembangan — dan itu berarti seluruh temuannya selalu punya catatan kaki
 * "angka ini tidak berlaku untuk produksi", tanpa cara apa pun untuk
 * menghilangkannya.
 *
 * Yang ingin dibuktikan justru sebaliknya: bahwa jaminan yang sama berlaku di
 * PostgreSQL sungguhan. Ketahuan ketika probe diarahkan ke PostgreSQL 16 asli
 * dan gagal dengan "client password must be a string" — bukan karena kodenya
 * salah, melainkan karena harness-nya tidak pernah bisa menunjuk ke mana pun
 * kecuali satu tempat.
 *
 *   DATABASE_URL   tujuan basis data. Bawaan: PGlite lokal.
 *   POS_API_URL    alamat pos-service. Bawaan: http://127.0.0.1:3101
 */
import pg from 'pg';

export const DB_URL =
  process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/postgres';

export const API_URL = process.env.POS_API_URL || 'http://127.0.0.1:3101';

/** Nama tujuan yang aman ditampilkan — kata sandinya disunting. */
export const tujuan = () => DB_URL.replace(/:[^:@/]*@/, ':***@');

export const conn = async () => {
  const c = new pg.Client({ connectionString: DB_URL });
  c.on('error', () => {});
  await c.connect();
  return c;
};

export const line = (s) => console.log(s);

/** Menunggu pos-service siap. Dipakai probe yang memerlukan HTTP. */
export async function tungguApi(detik = 30) {
  for (let i = 0; i < detik; i++) {
    if (await fetch(API_URL + '/ready').then((r) => r.ok).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
