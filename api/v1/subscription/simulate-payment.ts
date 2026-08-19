type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    // SSL wajib untuk database terkelola, dan mustahil untuk yang lokal —
    // Postgres di localhost menolak dengan "server does not support SSL".
    // Memaksanya membuat endpoint ini tidak bisa dijalankan atau diuji di mesin
    // sendiri sama sekali.
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  /*
   * DITUTUP DI PRODUKSI.
   *
   * Endpoint ini menyalakan langganan tanpa uang berpindah. Selama ia terbuka,
   * satu POST dengan tenantId mana pun sudah cukup untuk mengaktifkan paket
   * berbayar selama 30 hari — tanpa login, tanpa faktur, tanpa jejak. Seluruh
   * penegakan batas di aplikasi kasir menjadi tidak ada artinya, karena siapa
   * pun bisa memberi dirinya sendiri paket termahal.
   *
   * Gerbangnya sengaja sama persis dengan billing-service. Yang boleh
   * mengaktifkan langganan di produksi hanya webhook dari payment gateway.
   */
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SIMULATED_PAYMENT !== '1') {
    return res.status(403).json({
      ok: false,
      error: 'SIMULATION_DISABLED',
      detail: 'Pembayaran simulasi dimatikan di produksi. Aktivasi hanya lewat pembayaran sungguhan.',
    });
  }

  // Klien mengirim `targetPlanId`; versi awal berkas ini hanya membaca
  // `planId`, jadi paket yang dipilih merchant diabaikan dan semua orang
  // mendapat plan-pro-monthly. Keduanya diterima, dan tidak ada lagi paket
  // bawaan diam-diam — permintaan tanpa paket ditolak.
  const body = req.body ?? {};
  const tId = String(body.tenantId ?? '').trim();
  const targetPlan = String(body.targetPlanId ?? body.planId ?? '').trim();

  if (!tId || !targetPlan) {
    return res.status(400).json({
      ok: false,
      error: 'BAD_REQUEST',
      detail: 'tenantId dan targetPlanId wajib diisi.',
    });
  }

  const db = getPool();
  try {
    // Merchant diresolusi lewat jalur yang sama dengan seluruh sistem, BUKAN
    // dibuat di sini. legacy_uuid() menghasilkan tenant sintetis yang tidak
    // pernah ditemukan resolveTenant — langganannya menempel pada identitas
    // berbeda dari transaksinya, dan merchant merasa sudah bayar sementara
    // aplikasinya tetap terkunci.
    const tenant = await db.query(
      `SELECT merchant_id FROM contract.merchant_directory
        WHERE business_id = $1
           OR (owner_user_ref = $1 AND (SELECT COUNT(*) FROM contract.merchant_directory
                                         WHERE owner_user_ref = $1) = 1)
        LIMIT 1`,
      [tId]
    );
    if (!tenant.rows.length) {
      return res.status(409).json({
        ok: false,
        error: 'MERCHANT_BELUM_SINKRON',
        detail: 'Toko ini belum tersinkronisasi ke server, jadi belum ada yang bisa ditagih.',
      });
    }
    const tenantId = tenant.rows[0].merchant_id;

    // Paket harus benar-benar ada dan sedang dijual. Tanpa pemeriksaan ini,
    // kode paket yang salah ketik akan tersimpan sebagai langganan yang tidak
    // menunjuk paket mana pun, dan merchant kehilangan seluruh entitlementnya.
    const plan = await db.query(
      `SELECT id FROM billing.plans WHERE id = $1 AND is_active`,
      [targetPlan]
    );
    if (!plan.rows.length) {
      return res.status(400).json({ ok: false, error: 'PLAN_NOT_FOUND' });
    }

    const akhir = new Date(Date.now() + 30 * 86_400_000);

    // Satu langganan per merchant. Kunci uniknya tenant_id, bukan id sintetis —
    // dua baris untuk satu merchant membuat "paket mana yang berlaku" tidak
    // punya jawaban.
    const { rows } = await db.query(
      `INSERT INTO billing.subscriptions
         (id, tenant_id, plan_id, status, current_period_start, current_period_end)
       VALUES (uuidv7(), $1, $2, 'ACTIVE', CURRENT_TIMESTAMP, $3::timestamptz)
       ON CONFLICT (tenant_id) DO UPDATE SET
         plan_id            = EXCLUDED.plan_id,
         status             = 'ACTIVE',
         current_period_start = CURRENT_TIMESTAMP,
         current_period_end = EXCLUDED.current_period_end,
         updated_at         = CURRENT_TIMESTAMP
       RETURNING id, plan_id, status, current_period_end`,
      [tenantId, targetPlan, akhir.toISOString()]
    );

    const sub = rows[0];
    return res.status(200).json({
      ok: true,
      message: 'Pembayaran simulasi berhasil! Paket langganan Anda aktif.',
      subscription: {
        id: sub.id,
        planId: sub.plan_id,
        status: sub.status,
        currentPeriodEnd: sub.current_period_end,
      },
    });
  } catch (err: any) {
    console.error('[API Simulate Payment Error]:', err);
    return res.status(500).json({ ok: false, error: 'PAYMENT_FAILED', detail: err.message });
  }
}
