/**
 * POST /api/v1/webhooks/payment-gateway — aktivasi langganan dari pembayaran.
 *
 * Endpoint ini SEBELUMNYA HANYA ADA DI billing-service. Di Vercel, permintaan
 * gateway jatuh ke rewrite catch-all vercel.json, dijawab index.html, dan
 * dianggap berhasil oleh gateway karena statusnya 200 — jadi tidak ada satu pun
 * langganan yang pernah aktif lewat pembayaran sungguhan, dan tidak ada galat
 * yang muncul di mana pun. Satu-satunya jalur aktivasi yang bekerja adalah
 * simulate-payment, yang justru sudah ditutup di produksi.
 *
 * Perilakunya dibuat sama persis dengan billing-service:
 *
 *   1. Tanda tangan diperiksa SEBELUM apa pun dicatat
 *   2. eventId dicatat sekali; pengulangan dijawab 200 supaya gateway berhenti
 *   3. Faktur ditandai lunas dan langganan diperpanjang 30 hari
 */

type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';
import { verifikasiWebhook, ambilHeaderTandaTangan } from '../../../src/server/webhookAuth.js';
import { resolveTenantId } from '../../_lib/tenant.js';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
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

/**
 * Badan mentah, bukan hasil parse yang disusun ulang.
 *
 * Vercel sudah mem-parse JSON sebelum handler dipanggil, jadi byte aslinya
 * hilang kecuali dibaca dari stream. Kalau stream sudah habis, JSON.stringify
 * dipakai sebagai upaya terakhir — dan itu HANYA cocok bila gateway mengirim
 * JSON tanpa spasi dengan urutan kunci yang sama. Gateway yang tandatangannya
 * tidak pernah cocok hampir selalu tersandung di sini; jalan keluarnya
 * mematikan parser bawaan lewat `export const config = { api: { bodyParser:
 * false } }` pada runtime yang mendukungnya.
 */
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

  const hasil = verifikasiWebhook(
    mentah,
    ambilHeaderTandaTangan(req.headers as Record<string, unknown>),
    process.env.PAYMENT_WEBHOOK_SECRET
  );

  if (!hasil.sah) {
    // Alasannya untuk log kita, tidak untuk pemanggil.
    console.warn('[webhook] ditolak:', hasil.alasan);
    return res.status(401).json({ ok: false, error: 'SIGNATURE_INVALID' });
  }

  let body: any = req.body;
  if (!body || typeof body !== 'object') {
    try {
      body = JSON.parse(mentah);
    } catch {
      return res.status(400).json({ ok: false, error: 'BAD_JSON' });
    }
  }

  const eventId = String(body.eventId || body.id || '');
  const eventType = String(body.eventType || body.type || 'UNKNOWN');
  if (!eventId) return res.status(400).json({ ok: false, error: 'EVENT_ID_REQUIRED' });

  const db = getPool();
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const { rows: baru } = await client.query(
      `INSERT INTO billing.webhook_logs (id, event_id, event_type, payload)
       VALUES (uuidv7(), $1, $2, $3::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      [eventId, eventType, JSON.stringify(body)]
    );

    if (!baru.length) {
      // 200, bukan galat. Bagi gateway ini "sudah diproses"; menjawab galat
      // membuatnya mengirim ulang tanpa henti.
      await client.query('COMMIT');
      return res.status(200).json({ ok: true, replayed: true });
    }

    if (eventType === 'payment.succeeded' || eventType === 'invoice.paid') {
      const invoiceId = String(body.invoiceId || body.data?.invoiceId || '');
      const tenantRef = String(body.tenantId || body.data?.tenantId || '');

      if (invoiceId) {
        await client.query(
          `UPDATE billing.invoices
              SET payment_status = 'PAID', paid_at = CURRENT_TIMESTAMP,
                  payment_gateway_ref = COALESCE(payment_gateway_ref, $2)
            WHERE id = $1`,
          [invoiceId, eventId]
        );
      }

      const tenantId = await resolveTenantId(db, tenantRef);
      if (!tenantId) {
        // Bukan galat bagi gateway — uangnya memang diterima. Tapi dicatat,
        // karena langganan yang tidak bisa dilekatkan pada merchant adalah
        // pembayaran yang perlu ditangani orang.
        await client.query('COMMIT');
        console.warn('[webhook] merchant belum tersinkronisasi:', tenantRef, eventId);
        return res.status(200).json({ ok: true, replayed: false, warning: 'MERCHANT_BELUM_SINKRON' });
      }

      const planId = String(body.planId || body.data?.planId || '');
      const akhir = new Date(Date.now() + 30 * HARI_MS).toISOString();

      // Paket hanya diganti bila webhook menyebutnya DAN paketnya benar-benar
      // dijual. Tanpa penjagaan ini, kode paket salah ketik dari gateway
      // menghasilkan langganan yang tidak menunjuk paket mana pun, dan merchant
      // kehilangan seluruh entitlementnya justru setelah membayar.
      await client.query(
        `INSERT INTO billing.subscriptions
           (id, business_id, plan_id, status, current_period_start, current_period_end)
         VALUES (uuidv7(), $1,
                 COALESCE((SELECT id FROM billing.plans WHERE id = $2 AND is_active), 'plan-free'),
                 'ACTIVE', CURRENT_TIMESTAMP, $3::timestamptz)
         ON CONFLICT (business_id) DO UPDATE SET
           plan_id = COALESCE(
             (SELECT id FROM billing.plans WHERE id = $2 AND is_active),
             billing.subscriptions.plan_id
           ),
           status               = 'ACTIVE',
           current_period_start = CURRENT_TIMESTAMP,
           current_period_end   = EXCLUDED.current_period_end,
           updated_at           = CURRENT_TIMESTAMP`,
        [tenantId, planId, akhir]
      );
    }

    await client.query('COMMIT');
    return res.status(200).json({ ok: true, replayed: false });
  } catch (err: any) {
    await client.query('ROLLBACK');
    // 500 supaya gateway MENGIRIM ULANG. Menjawab 200 saat penyimpanan gagal
    // berarti pembayaran yang sudah diterima tidak pernah mengaktifkan apa pun,
    // dan tidak ada yang akan mencoba lagi.
    console.error('[webhook] gagal:', err?.message);
    return res.status(500).json({ ok: false, error: 'WEBHOOK_FAILED' });
  } finally {
    client.release();
  }
}
