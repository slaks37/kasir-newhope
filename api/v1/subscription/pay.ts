/**
 * POST /api/v1/subscription/pay — membuat sesi pembayaran DOKU untuk sebuah paket.
 *
 * Merchant memilih paket, endpoint ini menerbitkan faktur, memanggil DOKU, dan
 * mengembalikan URL halaman pembayaran berisi QRIS.
 *
 * TIDAK ADA YANG DIAKTIFKAN DI SINI. Yang mengaktifkan langganan hanya
 * notifikasi DOKU yang tanda tangannya sah (api/v1/webhooks/doku.ts).
 * Mengaktifkan di sini berarti siapa pun yang memanggil endpoint ini mendapat
 * paket berbayar tanpa pernah membuka halaman pembayarannya.
 */

type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';
import { resolveTenantId } from '../../_lib/tenant.js';
import { konfigurasi, buatPembayaran } from '../../_lib/doku.js';

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

/**
 * Nomor faktur: unik global, dan bisa dilacak balik tanpa membuka database.
 *
 * Awalan `NH` menandai sistem kita di dasbor DOKU yang mungkin dipakai bersama
 * integrasi lain. Enam karakter acak di belakang mencegah dua permintaan pada
 * milidetik yang sama menghasilkan nomor kembar — kalau itu terjadi, INSERT-nya
 * ditolak indeks unik, dan itu memang yang seharusnya.
 */
function nomorFaktur(): string {
  const t = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const acak = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `NH-${t}-${acak}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const cfg = konfigurasi();
  if (!cfg) {
    // Bukan 500. Ini keadaan yang bisa diperbaiki orang, dan pesannya harus
    // mengatakan apa yang kurang.
    return res.status(503).json({
      ok: false,
      error: 'PEMBAYARAN_BELUM_DIKONFIGURASI',
      detail: 'DOKU_CLIENT_ID dan DOKU_SECRET_KEY belum diset di server.',
    });
  }

  const body = req.body ?? {};
  const tenantRef = String(body.tenantId ?? body.businessId ?? '').trim();
  const planId = String(body.planId ?? body.targetPlanId ?? '').trim();
  const billingCycle = body.billingCycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY';

  if (!tenantRef || !planId) {
    return res.status(400).json({
      ok: false, error: 'BAD_REQUEST', detail: 'tenantId dan planId wajib diisi.',
    });
  }

  const db = getPool();
  const client = await db.connect();

  try {
    const tenantId = await resolveTenantId(db, tenantRef);
    if (!tenantId) {
      return res.status(409).json({
        ok: false, error: 'MERCHANT_BELUM_SINKRON',
        detail: 'Toko ini belum tersinkronisasi ke server, jadi belum ada yang bisa ditagih.',
      });
    }

    // HARGA DIBACA DARI DATABASE, tidak pernah dari permintaan. Menerima nominal
    // dari klien berarti siapa pun bisa membeli paket termahal seharga Rp 1.
    const { rows: paket } = await client.query(
      `SELECT id, name, price_idr, price_yearly_idr
         FROM billing.plans WHERE id = $1 AND is_active`,
      [planId]
    );
    if (!paket.length) return res.status(400).json({ ok: false, error: 'PLAN_NOT_FOUND' });

    const p = paket[0];
    // Harga tahunan disimpan sebagai harga PER BULAN bila ditagih tahunan —
    // sama seperti yang ditampilkan kartu harga, jadi setahun = 12x.
    const nominal =
      billingCycle === 'YEARLY' && p.price_yearly_idr != null
        ? Number(p.price_yearly_idr) * 12
        : Number(p.price_idr);

    if (nominal <= 0) {
      return res.status(400).json({
        ok: false, error: 'PAKET_GRATIS',
        detail: 'Paket ini tidak berbayar, jadi tidak ada yang perlu dibayar.',
      });
    }

    await client.query('BEGIN');

    // Langganan harus ada supaya faktur punya induk. Statusnya TIDAK diubah di
    // sini — merchant baru mendapat baris langganan, bukan paket aktif.
    const { rows: sub } = await client.query(
      `INSERT INTO billing.subscriptions
         (id, tenant_id, plan_id, status, current_period_start, current_period_end)
       VALUES (uuidv7(), $1, 'plan-free', 'TRIAL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [tenantId]
    );

    const { rows: merchant } = await client.query(
      `SELECT name, external_ref FROM pos.tenants WHERE id = $1`,
      [tenantId]
    );

    const invoiceNumber = nomorFaktur();
    const kedaluwarsaMenit = 60;

    const { rows: faktur } = await client.query(
      `INSERT INTO billing.invoices
         (id, subscription_id, tenant_id, invoice_number, plan_id, billing_cycle,
          amount, currency, payment_status, due_date, expires_at)
       VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, 'IDR', 'PENDING',
               CURRENT_TIMESTAMP + ($7::int || ' minutes')::interval,
               CURRENT_TIMESTAMP + ($7::int || ' minutes')::interval)
       RETURNING id`,
      [sub[0].id, tenantId, invoiceNumber, planId, billingCycle, nominal, kedaluwarsaMenit]
    );

    // Faktur ditulis SEBELUM DOKU dipanggil. Kalau urutannya dibalik dan
    // penulisan gagal setelah DOKU membuat sesi, pelanggan bisa membayar sesuatu
    // yang tidak punya catatan di sisi kita — dan notifikasinya tidak akan
    // menemukan faktur mana pun untuk dicocokkan.
    await client.query('COMMIT');

    const asal = String(req.headers?.origin || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const hasil = await buatPembayaran(cfg, {
      invoiceNumber,
      amount: nominal,
      callbackUrl: `${asal}/settings?billing=selesai&invoice=${encodeURIComponent(invoiceNumber)}`,
      namaPaket: `Langganan ${p.name} (${billingCycle === 'YEARLY' ? '1 tahun' : '1 bulan'})`,
      merchant: {
        id: merchant[0]?.external_ref || tenantId,
        name: merchant[0]?.name || 'Merchant',
      },
      kedaluwarsaMenit,
    });

    if (!hasil.ok) {
      // Fakturnya ditandai gagal, bukan dibiarkan menggantung sebagai PENDING
      // yang tidak akan pernah dibayar dan mengotori daftar tagihan merchant.
      await db.query(
        `UPDATE billing.invoices SET payment_status = 'FAILED', updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [faktur[0].id]
      );
      console.error('[doku] gagal membuat pembayaran:', hasil.detail);
      return res.status(502).json({
        ok: false, error: 'GATEWAY_GAGAL',
        detail: 'Gagal menghubungi penyedia pembayaran. Coba lagi sebentar lagi.',
      });
    }

    await db.query(
      `UPDATE billing.invoices
          SET payment_link_url = $2, payment_gateway_ref = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [faktur[0].id, hasil.paymentUrl, hasil.tokenId ?? null]
    );

    return res.status(200).json({
      ok: true,
      invoiceNumber,
      paymentUrl: hasil.paymentUrl,
      amount: nominal,
      planId,
      billingCycle,
      expiresAt: hasil.expiredDate ?? null,
      message: 'Buka tautan ini untuk memindai QRIS dan menyelesaikan pembayaran.',
    });
  } catch (err: any) {
    try { await client.query('ROLLBACK'); } catch { /* koneksi mungkin sudah putus */ }
    console.error('[API Subscription Pay Error]:', err?.message);
    return res.status(503).json({ ok: false, error: 'PAYMENT_INIT_FAILED' });
  } finally {
    client.release();
  }
}
