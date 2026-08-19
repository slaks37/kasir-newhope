/**
 * POST /api/v1/assistant/credits/topup — menambah kredit AI sebuah merchant.
 *
 * DITUTUP DI PRODUKSI, dengan alasan yang sama seperti simulate-payment.
 *
 * Versi sebelumnya menerima permintaan tanpa autentikasi apa pun, dan kalau
 * body-nya kosong ia memakai `merchantId = 'usr-1_FNB'` sebagai bawaan. Jadi
 * satu POST kosong sudah cukup untuk menambah 50 kredit ke dompet milik orang
 * lain, berkali-kali, tanpa uang berpindah dan tanpa jejak. Seluruh kuota AI
 * yang baru saja diikat ke paket langganan menjadi tidak berarti, karena siapa
 * pun bisa mengisi ulang dompetnya sendiri.
 *
 * Dua hal lain yang ikut diperbaiki:
 *
 *   - `legacy_uuid($1)` membuat merchant sintetis yang tidak pernah ditemukan
 *     resolver mana pun. Kreditnya menempel pada identitas berbeda dari
 *     transaksinya: merchant merasa sudah top-up, tapi asistennya tetap bilang
 *     kuota habis.
 *
 *   - Blok catch mengembalikan `ok: true` dengan `balance: 150` saat top-up
 *     GAGAL. Angka itu tidak pernah ada di database. Kegagalan yang dilaporkan
 *     sebagai keberhasilan adalah kegagalan yang tidak akan pernah diperbaiki.
 */

type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';
import { resolveTenantId } from '../../../_lib/tenant.js';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    // SSL wajib untuk database terkelola, dan mustahil untuk yang lokal —
    // Postgres di localhost menolak dengan "server does not support SSL".
    const url = process.env.DATABASE_URL || '';
    const lokal = /@(127\.0\.0\.1|localhost)|host=\//.test(url);

    pool = new pg.Pool({
      connectionString: url,
      ssl: lokal ? undefined : { rejectUnauthorized: false },
      max: 10,
    });
  }
  return pool;
}

const MAKS_SEKALI_TOPUP = 500;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SIMULATED_PAYMENT !== '1') {
    return res.status(403).json({
      ok: false,
      error: 'TOPUP_SIMULATION_DISABLED',
      detail: 'Top-up kredit gratis dimatikan di produksi. Penambahan kredit hanya lewat pembayaran sungguhan.',
    });
  }

  const body = req.body ?? {};
  const merchantRef = String(body.merchantId ?? body.tenantId ?? '').trim();
  const diminta = Math.trunc(Number(body.credits));

  // Tidak ada merchant bawaan. Permintaan yang tidak menyebut siapa yang
  // di-top-up adalah permintaan yang salah, bukan permintaan untuk 'usr-1_FNB'.
  if (!merchantRef) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', detail: 'merchantId wajib diisi.' });
  }
  if (!Number.isFinite(diminta) || diminta <= 0 || diminta > MAKS_SEKALI_TOPUP) {
    return res.status(400).json({
      ok: false,
      error: 'BAD_REQUEST',
      detail: `credits harus antara 1 dan ${MAKS_SEKALI_TOPUP}.`,
    });
  }

  const db = getPool();
  try {
    const tenantId = await resolveTenantId(db, merchantRef);
    if (!tenantId) {
      return res.status(409).json({
        ok: false,
        error: 'MERCHANT_BELUM_SINKRON',
        detail: 'Toko ini belum tersinkronisasi ke server, jadi dompetnya belum ada.',
      });
    }

    // Dompet yang belum ada dibuat dengan monthly_grant 0, BUKAN 100.
    // Jatah bulanan datang dari paket langganan (contract.merchant_entitlements);
    // menuliskan angka karangan di sini akan disamakan lagi oleh sinkronisasi
    // paket pada permintaan berikutnya, dan sementara itu merchant melihat kuota
    // yang tidak dia beli.
    const { rows } = await db.query(
      `INSERT INTO ai.merchant_ai_credits
         (merchant_id, balance, monthly_grant, used_this_month, period_reset_at)
       VALUES ($1::uuid, $2, 0, 0, date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month')
       ON CONFLICT (merchant_id) DO UPDATE SET
         balance    = ai.merchant_ai_credits.balance + $2,
         updated_at = CURRENT_TIMESTAMP
       RETURNING balance`,
      [tenantId, diminta]
    );

    return res.status(200).json({
      ok: true,
      message: `Top-up ${diminta} kredit AI berhasil.`,
      balance: Number(rows[0].balance),
    });
  } catch (err: any) {
    // Gagal adalah gagal. Saldo TIDAK dikarang di sini — angka yang dilaporkan
    // ke merchant harus selalu angka yang benar-benar ada di database.
    console.error('[API Topup Error]:', err?.message);
    return res.status(503).json({ ok: false, error: 'TOPUP_FAILED' });
  }
}
