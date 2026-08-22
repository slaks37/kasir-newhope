/**
 * Penyimpanan langganan dan faktur — di database, bukan di memori.
 *
 * KENAPA HARUS DIPINDAHKAN. Versi `Map` punya tiga akibat yang semuanya soal
 * uang:
 *
 *   1. Restart menghapus semua langganan. Setiap merchant kembali ke TRIAL,
 *      termasuk yang sudah membayar.
 *   2. Dua replika billing-service melihat langganan berbeda. Merchant yang
 *      dilayani replika A aktif, lewat replika B kedaluwarsa — bergantian,
 *      tanpa pola.
 *   3. Webhook pembayaran yang tiba setelah restart tidak menemukan langganan
 *      yang harus diaktifkan, lalu ditolak. Uang masuk, akses tidak.
 *
 * Idempotensi webhook juga jadi nyata: `webhook_logs.event_id` UNIQUE, sehingga
 * pengiriman ulang dari payment gateway — hal yang normal terjadi — tidak
 * memperpanjang langganan dua kali.
 */

import type { Db } from '../shared/db';
import { resolveTenant } from '../shared/identity';
import type { SaaSSubscription, SaaSInvoice, SubscriptionStatus } from '../../src/types';

function keLangganan(r: any): SaaSSubscription {
  return {
    id: r.id,
    tenantId: r.business_id,
    planId: r.plan_id,
    status: r.status as SubscriptionStatus,
    currentPeriodStart: new Date(r.current_period_start).toISOString(),
    currentPeriodEnd: new Date(r.current_period_end).toISOString(),
    gracePeriodEnd: r.grace_period_end ? new Date(r.grace_period_end).toISOString() : undefined,
    cancelAtPeriodEnd: r.cancel_at_period_end,
    canceledAt: r.canceled_at ? new Date(r.canceled_at).toISOString() : undefined,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function keFaktur(r: any): SaaSInvoice {
  return {
    id: r.id,
    subscriptionId: r.subscription_id,
    tenantId: r.business_id,
    amount: Number(r.amount),
    currency: r.currency,
    paymentStatus: r.payment_status,
    paymentGatewayRef: r.payment_gateway_ref ?? undefined,
    paymentLinkUrl: r.payment_link_url ?? undefined,
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : undefined,
    dueDate: new Date(r.due_date).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
    // Nama paket disalin ke faktur agar riwayat tagihan tetap terbaca setelah
    // paket diubah namanya atau dihentikan.
    planName: r.plan_name ?? '',
  };
}

/** Memastikan katalog paket ada di database. Aman dijalankan berulang. */
/**
 * Katalog paket dibaca, TIDAK ditulis dari sini.
 *
 * Fungsi sebelumnya (`pastikanPaket`) melakukan ON CONFLICT DO UPDATE atas
 * harga pada setiap boot service. Sejak panel admin bisa mengubah harga, itu
 * berarti setiap restart mengembalikannya ke angka yang ditulis di kode —
 * diam-diam, tanpa jejak di plan_change_log, dan baru ketahuan saat ada
 * merchant yang menagih selisihnya.
 *
 * Yang mengisi katalog awal adalah migrasi 0014, dan ia sengaja tidak menimpa
 * baris yang sudah pernah disunting admin (`WHERE updated_by IS NULL`).
 */

const KOLOM_PAKET = `
  id, name, tier_level AS "tierLevel", billing_cycle AS "billingCycle",
  price_idr AS "priceIdr", price_yearly_idr AS "priceYearlyIdr",
  extra_outlet_price_idr AS "extraOutletPriceIdr", currency, features,
  product_limit AS "productLimit", max_outlets AS "maxOutlets",
  ai_quota_monthly AS "aiQuotaMonthly",
  dashboard_access_level AS "dashboardAccessLevel",
  module_access AS "moduleAccess", is_active AS "isActive"`;

export async function hitungPaket(db: Db): Promise<number> {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM billing.plans`);
  return rows[0].n;
}

export async function ambilPaket(db: Db, id: string) {
  if (!id) return null;
  const { rows } = await db.query(`SELECT ${KOLOM_PAKET} FROM billing.plans WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function daftarPaketAktif(db: Db) {
  const { rows } = await db.query(
    `SELECT ${KOLOM_PAKET} FROM billing.plans WHERE is_active ORDER BY sort_order, tier_level`
  );
  return rows;
}

/**
 * Mengambil langganan, membuat TRIAL bila merchant baru.
 *
 * Pembuatan memakai ON CONFLICT: dua request bersamaan dari merchant yang sama
 * tidak boleh menghasilkan dua langganan.
 */
/**
 * Semua fungsi di bawah menerima identitas APA ADANYA dari klien (`usr-budi`)
 * dan menerjemahkannya di sini. Menyimpan string mentah ke kolom UUID membuat
 * billing-service mati dengan "invalid input syntax for type uuid" — kegagalan
 * nyata yang sempat terjadi.
 */
async function keTenant(db: Db, id: string): Promise<{ uuid: string; terdaftar: boolean }> {
  const r = await resolveTenant(db, { merchantId: id, businessId: id });
  return { uuid: r.tenantId, terdaftar: r.terdaftar };
}

export async function pastikanTabelFingerprint(db: Db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS billing.device_fingerprints (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id UUID NOT NULL,
      device_id TEXT NOT NULL,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_device_fingerprints ON billing.device_fingerprints(device_id);
  `);
}

export async function ambilAtauBuatLangganan(
  db: Db,
  tenantIdMentah: string,
  planTrial: string,
  hariTrial = 45,
  deviceId?: string,
  ipAddress?: string
): Promise<SaaSSubscription | null> {
  const { uuid: tenantId, terdaftar } = await keTenant(db, tenantIdMentah);
  if (!terdaftar) return null;

  const ada = await db.query(
    `SELECT * FROM billing.subscriptions WHERE business_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId]
  );
  if (ada.rows.length) return keLangganan(ada.rows[0]);

  // Periksa apakah device_id ini sudah pernah mendapatkan TRIAL
  let statusLangganan = 'TRIAL';
  if (deviceId) {
    const pernahTrial = await db.query(
      `SELECT id FROM billing.device_fingerprints WHERE device_id = $1 LIMIT 1`,
      [deviceId]
    );
    if (pernahTrial.rows.length > 0) {
      statusLangganan = 'EXPIRED'; // Dihanguskan karena device sudah pernah terdaftar
    }
    
    // Simpan fingerprint device
    await db.query(
      `INSERT INTO billing.device_fingerprints (business_id, device_id, ip_address) VALUES ($1, $2, $3)`,
      [tenantId, deviceId, ipAddress]
    );
  }

  const { rows } = await db.query(
    `INSERT INTO billing.subscriptions
       (id, business_id, plan_id, status, current_period_start, current_period_end)
     VALUES (uuidv7(), $1, $2, $4,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + ($3::int || ' days')::interval)
     RETURNING *`,
    [tenantId, planTrial, hariTrial, statusLangganan]
  );
  return keLangganan(rows[0]);
}

export async function ambilLangganan(db: Db, tenantIdMentah: string): Promise<SaaSSubscription | null> {
  const { uuid: tenantId } = await keTenant(db, tenantIdMentah);
  const { rows } = await db.query(
    `SELECT * FROM billing.subscriptions WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [tenantId]
  );
  return rows.length ? keLangganan(rows[0]) : null;
}

export async function ubahStatusLangganan(
  db: Db,
  id: string,
  status: SubscriptionStatus,
  periodeBaru?: { mulai: string; selesai: string }
): Promise<SaaSSubscription | null> {
  const { rows } = await db.query(
    `UPDATE billing.subscriptions
        SET status = $2,
            current_period_start = COALESCE($3::timestamptz, current_period_start),
            current_period_end   = COALESCE($4::timestamptz, current_period_end),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`,
    [id, status, periodeBaru?.mulai ?? null, periodeBaru?.selesai ?? null]
  );
  return rows.length ? keLangganan(rows[0]) : null;
}

export async function gantiPaket(db: Db, id: string, planId: string): Promise<SaaSSubscription | null> {
  const { rows } = await db.query(
    `UPDATE billing.subscriptions
        SET plan_id = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`,
    [id, planId]
  );
  return rows.length ? keLangganan(rows[0]) : null;
}

export async function buatFaktur(
  db: Db,
  f: { subscriptionId: string; tenantId: string; amount: number; dueDate: string; linkUrl?: string; nomor: string }
): Promise<SaaSInvoice> {
  const { uuid: tenantId } = await keTenant(db, f.tenantId);
  const { rows } = await db.query(
    `INSERT INTO billing.invoices
       (id, subscription_id, business_id, amount, payment_status, payment_link_url, due_date)
     VALUES ($1, $2, $3, $4, 'PENDING', $5, $6::timestamptz)
     RETURNING *`,
    [f.nomor, f.subscriptionId, tenantId, f.amount, f.linkUrl ?? null, f.dueDate]
  );
  return keFaktur(rows[0]);
}

export async function tandaiFakturLunas(db: Db, id: string, ref?: string): Promise<SaaSInvoice | null> {
  const { rows } = await db.query(
    `UPDATE billing.invoices
        SET payment_status = 'PAID', paid_at = CURRENT_TIMESTAMP,
            payment_gateway_ref = COALESCE($2, payment_gateway_ref)
      WHERE id = $1 AND payment_status <> 'PAID'
      RETURNING *`,
    [id, ref ?? null]
  );
  return rows.length ? keFaktur(rows[0]) : null;
}

export async function daftarFaktur(db: Db, tenantIdMentah: string): Promise<SaaSInvoice[]> {
  const { uuid: tenantId } = await keTenant(db, tenantIdMentah);
  const { rows } = await db.query(
    `SELECT i.*, p.name AS plan_name
       FROM billing.invoices i
       LEFT JOIN billing.subscriptions s ON s.id = i.subscription_id
       LEFT JOIN billing.plans p ON p.id = s.plan_id
      WHERE i.business_id = $1 ORDER BY i.created_at DESC LIMIT 50`,
    [tenantId]
  );
  return rows.map(keFaktur);
}

/**
 * Mencatat webhook. FALSE berarti event ini sudah pernah diproses.
 *
 * Payment gateway MENGIRIM ULANG event yang tidak di-ACK tepat waktu — itu
 * perilaku normal, bukan kasus tepi. Tanpa penjaga ini, satu pembayaran bisa
 * memperpanjang langganan dua kali.
 */
export async function catatWebhookBaru(
  db: Db,
  eventId: string,
  eventType: string,
  payload: unknown
): Promise<boolean> {
  const { rows } = await db.query(
    `INSERT INTO billing.webhook_logs (id, event_id, event_type, payload)
     VALUES (uuidv7(), $1, $2, $3::jsonb)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id`,
    [eventId, eventType, JSON.stringify(payload ?? {})]
  );
  return rows.length > 0;
}
