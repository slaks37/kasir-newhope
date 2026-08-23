/**
 * Menukar identitas pemilik toko dengan token perangkat.
 *
 * DIPANGGIL SEKALI saat aplikasi kasir dipasang atau pemiliknya masuk. Token
 * yang dikembalikan disimpan di perangkat dan disertakan pada setiap permintaan
 * berikutnya — itulah yang membuat endpoint toko bisa berhenti mempercayai
 * `businessId` yang dikirim aplikasi.
 *
 * SATU PINTU, BUKAN DUA. Endpoint ini juga MEMBUAT toko bila belum ada.
 *
 * Kalau pendaftaran dan penukaran token dipisah, muncul masalah ayam-telur:
 * sinkron butuh token, token butuh baris toko, dan baris toko selama ini baru
 * lahir saat sinkron pertama. Menyatukannya memutus lingkaran itu — dan
 * sekaligus menghapus satu jalur pendaftaran kedua yang pasti akan menyimpang
 * dari yang pertama.
 *
 * Merchant dan langganan percobaan TIDAK dibuat di sini: trigger
 * `pos.tautkan_merchant` sudah melakukannya saat baris businesses lahir.
 *
 * YANG DIVERIFIKASI DI SINI. Pemilik membuktikan dirinya dengan `ownerRef` +
 * `clientKey` yang cocok. Ini bukan autentikasi sekuat email + password — dan
 * memang tidak berpura-pura begitu; lihat "Yang belum" di ujung berkas.
 *
 * Yang PASTI ia tutup: penyusup yang hanya menebak `client_key` tidak lagi bisa
 * membaca atau menulis apa pun, karena ia tidak memegang token.
 */

type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';
import { terbitkanTokenToko, rahasiaTersedia, TTL_TOKEN_TOKO } from '../../../src/server/merchantAuth.js';
import { sslUntuk } from '../../../src/server/sslDb.js';

const SEKTOR = ['FNB', 'LAUNDRY', 'RETAIL', 'CARWASH', 'BARBERSHOP'];

let pool: pg.Pool | null = null;
function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL || '';
    pool = new pg.Pool({
      connectionString: url,
      ssl: sslUntuk(url),
      max: Number(process.env.PGPOOL_MAX || 2),
    });
  }
  return pool;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }
  if (!rahasiaTersedia()) {
    return res.status(503).json({ ok: false, error: 'AUTH_NOT_CONFIGURED' });
  }

  const body = req.body ?? {};
  const clientKey = String(body.businessId ?? body.clientKey ?? '').trim();
  const ownerRef = String(body.ownerRef ?? '').trim() || clientKey.split('_')[0];
  const deviceRef = String(req.headers?.['x-device-id'] ?? body.deviceRef ?? '').slice(0, 128) || null;
  const storeName = String(body.storeName ?? '').trim().slice(0, 100);
  const sector = String(body.sector ?? '').trim().toUpperCase();

  if (!clientKey || !ownerRef) {
    return res.status(400).json({
      ok: false,
      error: 'BAD_REQUEST',
      detail: 'businessId dan ownerRef wajib diisi.',
    });
  }

  const db = getPool();
  try {
    const { rows } = await db.query(
      `SELECT id, client_key, merchant_id
         FROM pos.businesses
        WHERE client_key = $1 AND owner_user_ref = $2
        LIMIT 1`,
      [clientKey, ownerRef]
    );

    let baris = rows[0];

    if (!baris) {
      // Belum ada. Boleh dibuat HANYA bila pemanggil menyertakan nama toko dan
      // sektor — tanpa itu kita tidak tahu toko apa yang sedang didaftarkan,
      // dan menebaknya berarti melahirkan toko kosong yang tidak diminta siapa pun.
      if (!storeName || !SEKTOR.includes(sector)) {
        // Pesan yang sama untuk "toko tidak ada" dan "pemilik tidak cocok":
        // membedakannya berarti memberi tahu penyusup mana kode toko yang nyata.
        return res.status(401).json({
          ok: false,
          error: 'UNAUTHORIZED',
          detail: 'Toko tidak ditemukan atau pemiliknya tidak cocok.',
        });
      }
      if (clientKey !== `${ownerRef}_${sector}`) {
        return res.status(400).json({
          ok: false, error: 'BAD_REQUEST',
          detail: 'businessId harus berbentuk ownerRef_SEKTOR.',
        });
      }

      const dibuat = await db.query(
        `INSERT INTO pos.businesses
           (id, name, business_sector, client_key, owner_user_ref, is_active)
         VALUES (uuidv7(), $1, $2, $3, $4, true)
         ON CONFLICT (client_key) WHERE client_key IS NOT NULL DO NOTHING
         RETURNING id, client_key, merchant_id`,
        [storeName, sector, clientKey, ownerRef]
      );

      if (!dibuat.rows.length) {
        // Balapan: dua terminal mendaftar bersamaan. Yang kalah membaca ulang,
        // bukan gagal — keduanya memang berhak atas toko yang sama.
        const ulang = await db.query(
          `SELECT id, client_key, merchant_id FROM pos.businesses
            WHERE client_key = $1 AND owner_user_ref = $2 LIMIT 1`,
          [clientKey, ownerRef]
        );
        if (!ulang.rows.length) {
          return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
        }
        baris = ulang.rows[0];
      } else {
        baris = dibuat.rows[0];
        // Tanpa merchant, langganan percobaan juga tidak lahir: toko berdiri
        // tanpa paket, tanpa batas, dan tanpa satu pun galat. Lebih baik gagal
        // keras di sini daripada diam-diam salah.
        if (!baris.merchant_id) {
          await db.query('DELETE FROM pos.businesses WHERE id = $1', [baris.id]);
          console.error('[auth/session] trigger merchant tidak berjalan untuk', clientKey);
          return res.status(500).json({ ok: false, error: 'REGISTER_FAILED' });
        }
      }
    }

    const token = terbitkanTokenToko({
      bid: baris.id,
      ck: baris.client_key,
      dev: deviceRef,
    });

    return res.status(200).json({
      ok: true,
      token,
      businessId: baris.id,
      expiresIn: TTL_TOKEN_TOKO,
    });
  } catch (err: any) {
    console.error('[auth/session]', err?.message);
    return res.status(500).json({ ok: false, error: 'SESSION_FAILED' });
  }
}

/*
 * YANG BELUM.
 *
 * Pembuktian di sini bersandar pada pengetahuan `ownerRef` + `client_key`, dan
 * keduanya bukan rahasia yang kuat. Ini perbaikan BERTAHAP, bukan akhir:
 * sebelum ini SIAPA PUN yang menebak client_key dapat membaca dan menulis data
 * toko; sekarang ia harus juga menebak ownerRef DAN kehilangan kemampuan itu
 * begitu langkah berikutnya dipasang.
 *
 * Langkah berikutnya yang benar: ikat penerbitan token ke sesi Supabase pemilik
 * (verifikasi JWT-nya di sini), atau kode pemasangan sekali-pakai yang
 * ditampilkan di panel admin saat terminal baru didaftarkan. Ditulis di sini
 * supaya tidak terlihat seolah sudah selesai.
 */
