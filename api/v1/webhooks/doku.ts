/**
 * POST /api/v1/webhooks/doku — notifikasi pembayaran dari DOKU.
 *
 * SATU-SATUNYA jalur yang mengaktifkan langganan berbayar. Daftarkan URL ini di
 * dasbor DOKU sebagai Notification URL, lalu set DOKU_NOTIFICATION_PATH ke
 * path-nya (bawaan: /api/v1/webhooks/doku).
 *
 * TIGA PENJAGAAN, dan ketiganya perlu:
 *
 *   1. TANDA TANGAN. DOKU menandatangani setiap notifikasi. Tanpa pemeriksaan
 *      ini, siapa pun yang tahu URL-nya bisa mengirim "SUCCESS" dan mendapat
 *      paket termahal tanpa uang berpindah.
 *
 *   2. FAKTUR KITA SENDIRI. Merchant yang diaktifkan dan paket yang diberikan
 *      dibaca dari baris faktur yang KITA tulis saat membuat pembayaran —
 *      bukan dari badan notifikasi. Tanda tangan menjamin pesannya asli;
 *      pencocokan lewat faktur yang menjamin uangnya mendarat di merchant yang
 *      benar dan membeli paket yang benar.
 *
 *   3. NOMINAL. Notifikasi yang jumlahnya tidak sama dengan tagihan ditolak
 *      aktivasinya. Membayar Rp 1 untuk faktur Rp 299.000 bukan pembayaran.
 */

type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';
import { verifikasiNotifikasi } from '../../../src/server/dokuSignature.js';
import { bacaNotifikasi, pembayaranBerhasil } from '../../_lib/doku.js';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    pg.types.setTypeParser(1700, (v: string) => (v === null ? null : Number(v)));
    const url = process.env.DATABASE_URL || '';
    const lokal = /@(127\.0\.0\.1|localhost)|host=\//.test(url);
    pool = new pg.Pool({
      connectionString: url,
      ssl: lokal ? undefined : { rejectUnauthorized: false },
      max: Number(process.env.PGPOOL_MAX || 2),
    });
  }
  return pool;
}

const HARI_MS = 86_400_000;

async function badanMentah(req: VercelRequest): Promise<string> {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (req.readable) {
    const potongan: Buffer[] = [];
    for await (const p of req) potongan.push(Buffer.isBuffer(p) ? p : Buffer.from(p));
    if (potongan.length) return Buffer.concat(potongan).toString('utf8');
  }
  return typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const mentah = await badanMentah(req);

  const hasil = verifikasiNotifikasi({
    rawBody: mentah,
    headers: (req.headers ?? {}) as Record<string, unknown>,
    secretKey: process.env.DOKU_SECRET_KEY,
    // Path yang DOKU pakai saat menandatangani adalah path URL notifikasi KITA.
    // Salah nilai di sini membuat SETIAP notifikasi sah ditolak — dan gejalanya
    // terlihat seperti DOKU mengirim tanda tangan yang salah.
    requestTarget: process.env.DOKU_NOTIFICATION_PATH?.trim() || '/api/v1/webhooks/doku',
  });

  if (!hasil.sah) {
    console.warn('[doku] notifikasi ditolak:', hasil.alasan);
    return res.status(401).json({ ok: false, error: 'SIGNATURE_INVALID' });
  }

  let body: any = req.body;
  if (!body || typeof body !== 'object') {
    try { body = JSON.parse(mentah); } catch { return res.status(400).json({ ok: false, error: 'BAD_JSON' }); }
  }

  const notif = bacaNotifikasi(body);
  if (!notif.invoiceNumber) {
    return res.status(400).json({ ok: false, error: 'INVOICE_NUMBER_REQUIRED' });
  }

  // Request-Id milik DOKU adalah kunci idempotensi kita: notifikasi yang sama
  // dikirim ulang tidak boleh memperpanjang langganan dua kali.
  const requestId = String(
    (req.headers?.['request-id'] ?? req.headers?.['Request-Id'] ?? '') || ''
  );

  const db = getPool();
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const { rows: baru } = await client.query(
      `INSERT INTO billing.webhook_logs (id, event_id, event_type, provider, payload)
       VALUES (uuidv7(), $1, $2, 'DOKU', $3::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      [`DOKU:${requestId || notif.invoiceNumber}`, notif.status, JSON.stringify(body)]
    );

    if (!baru.length) {
      // 200, bukan galat. Bagi DOKU ini "sudah diproses"; menjawab galat
      // membuatnya mengirim ulang tanpa henti.
      await client.query('COMMIT');
      return res.status(200).json({ ok: true, replayed: true });
    }

    // Baris dikunci supaya dua notifikasi yang tiba bersamaan untuk faktur yang
    // sama tidak sama-sama mengaktifkan dan memperpanjang dua kali.
    const { rows: faktur } = await client.query(
      `SELECT id, business_id, subscription_id, plan_id, billing_cycle, amount, payment_status
         FROM billing.invoices
        WHERE invoice_number = $1
        FOR UPDATE`,
      [notif.invoiceNumber]
    );

    if (!faktur.length) {
      // Tanda tangannya sah, tapi fakturnya bukan milik kita — biasanya berarti
      // satu Client-Id dipakai bersama integrasi lain. Diterima supaya DOKU
      // berhenti mengulang, dicatat supaya kita tahu.
      await client.query('COMMIT');
      console.warn('[doku] faktur tidak dikenal:', notif.invoiceNumber);
      return res.status(200).json({ ok: true, warning: 'FAKTUR_TIDAK_DIKENAL' });
    }

    const f = faktur[0];

    if (!pembayaranBerhasil(notif.status)) {
      await client.query(
        `UPDATE billing.invoices
            SET payment_status = CASE WHEN $2 IN ('EXPIRED','FAILED') THEN $2::payment_status_enum
                                      ELSE payment_status END,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [f.id, notif.status === 'EXPIRED' ? 'EXPIRED' : 'FAILED']
      );
      await client.query('COMMIT');
      return res.status(200).json({ ok: true, activated: false, status: notif.status });
    }

    // Nominal harus cocok. Selisih pembulatan rupiah tidak ada, jadi
    // perbandingannya boleh persis.
    if (notif.amount != null && Math.round(notif.amount) !== Math.round(Number(f.amount))) {
      await client.query('COMMIT');
      console.error(
        '[doku] nominal tidak cocok:', notif.invoiceNumber, notif.amount, 'vs', f.amount
      );
      return res.status(200).json({ ok: true, activated: false, warning: 'NOMINAL_TIDAK_COCOK' });
    }

    if (f.payment_status === 'PAID') {
      await client.query('COMMIT');
      return res.status(200).json({ ok: true, activated: false, warning: 'SUDAH_LUNAS' });
    }

    await client.query(
      `UPDATE billing.invoices
          SET payment_status = 'PAID', paid_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [f.id]
    );

    // Periode DITAMBAHKAN pada sisa yang masih berjalan, bukan menggantikannya.
    // Merchant yang memperpanjang lebih awal tidak boleh kehilangan hari yang
    // sudah dibayar.
    const durasiHari = f.billing_cycle === 'YEARLY' ? 365 : 30;
    await client.query(
      `UPDATE billing.subscriptions
          SET plan_id = $2,
              status = 'ACTIVE',
              current_period_start = CURRENT_TIMESTAMP,
              current_period_end = GREATEST(current_period_end, CURRENT_TIMESTAMP)
                                   + ($3::int || ' days')::interval,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [f.subscription_id, f.plan_id, durasiHari]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      ok: true,
      activated: true,
      invoiceNumber: notif.invoiceNumber,
      planId: f.plan_id,
      channel: notif.channel,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    // 500 supaya DOKU MENGIRIM ULANG. Menjawab 200 saat penyimpanan gagal
    // berarti pembayaran yang sudah diterima tidak pernah mengaktifkan apa pun,
    // dan tidak ada yang akan mencoba lagi.
    console.error('[doku] gagal memproses notifikasi:', err?.message);
    return res.status(500).json({ ok: false, error: 'NOTIFICATION_FAILED' });
  } finally {
    client.release();
  }
}
