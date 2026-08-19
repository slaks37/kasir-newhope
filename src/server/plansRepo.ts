/**
 * Baca-tulis katalog paket, untuk panel admin.
 *
 * Dipakai dua jalur sekaligus: route Express di backoffice-service dan fungsi
 * serverless di `api/admin/`. Keduanya memanggil fungsi yang sama persis,
 * karena dua salinan aturan harga adalah dua aturan harga yang akan berbeda.
 */

import type { Db } from './db';
import {
  validasiPaket,
  type AdminPlan,
  type DashboardAccessLevel,
} from '../lib/plans/entitlements';
import type { PermissionFeature } from '../types';

const KOLOM = `
  id, name, tier_level, billing_cycle, price_idr, price_yearly_idr,
  extra_outlet_price_idr, currency, features, product_limit, max_outlets,
  ai_quota_monthly, dashboard_access_level, module_access, is_active,
  sort_order, updated_by`;

function keAdminPlan(r: any): AdminPlan {
  return {
    id: r.id,
    name: r.name,
    tierLevel: Number(r.tier_level),
    billingCycle: r.billing_cycle,
    priceIdr: Number(r.price_idr),
    priceYearlyIdr: r.price_yearly_idr == null ? null : Number(r.price_yearly_idr),
    extraOutletPriceIdr: r.extra_outlet_price_idr == null ? null : Number(r.extra_outlet_price_idr),
    currency: r.currency || 'IDR',
    features: Array.isArray(r.features) ? r.features : [],
    productLimit: Number(r.product_limit),
    maxOutlets: Number(r.max_outlets),
    aiQuotaMonthly: Number(r.ai_quota_monthly),
    dashboardAccessLevel: r.dashboard_access_level as DashboardAccessLevel,
    moduleAccess: (r.module_access ?? []) as PermissionFeature[],
    isActive: r.is_active,
    sortOrder: Number(r.sort_order),
    updatedBy: r.updated_by ?? null,
  };
}

export async function daftarPaket(db: Db): Promise<AdminPlan[]> {
  const { rows } = await db.query(
    `SELECT ${KOLOM} FROM billing.plans ORDER BY sort_order, tier_level`
  );
  return rows.map(keAdminPlan);
}

/** Berapa merchant yang sedang memakai tiap paket — dipakai panel sebelum mengubah harga. */
export async function pemakaiPaket(db: Db): Promise<Record<string, number>> {
  const { rows } = await db.query(
    `SELECT plan_id, COUNT(*)::int AS jumlah
       FROM billing.subscriptions
      WHERE status IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
      GROUP BY plan_id`
  );
  return Object.fromEntries(rows.map((r: any) => [r.plan_id, r.jumlah]));
}

export async function riwayatPaket(db: Db, planId: string, limit = 20) {
  const { rows } = await db.query(
    `SELECT id, plan_id, changed_by, change_kind, before_json, after_json, changed_at
       FROM billing.plan_change_log
      WHERE plan_id = $1
      ORDER BY changed_at DESC
      LIMIT $2`,
    [planId, Math.min(Math.max(limit, 1), 100)]
  );
  return rows;
}

export class PlanValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join(' '));
  }
}

/**
 * Menyimpan satu paket, membuatnya bila belum ada.
 *
 * SATU TRANSAKSI untuk baris paket dan baris riwayatnya. Kalau riwayat ditulis
 * di luar transaksi dan gagal, harga tetap berubah tanpa ada catatan siapa yang
 * mengubahnya — dan justru perubahan yang tidak tercatat itulah yang paling
 * ingin ditelusuri belakangan.
 */
export async function simpanPaket(
  db: Db,
  masukan: AdminPlan,
  aktor: string
): Promise<{ plan: AdminPlan; kind: 'CREATE' | 'UPDATE' }> {
  const masalah = validasiPaket(masukan);
  if (masalah.length) throw new PlanValidationError(masalah);

  return db.tx(async (c) => {
    const lama = await c.query(`SELECT ${KOLOM} FROM billing.plans WHERE id = $1`, [masukan.id]);
    const sebelum = lama.rows.length ? keAdminPlan(lama.rows[0]) : null;

    const { rows } = await c.query(
      `INSERT INTO billing.plans
         (id, name, tier_level, billing_cycle, price_idr, price_yearly_idr,
          extra_outlet_price_idr, currency, features, product_limit, max_outlets,
          ai_quota_monthly, dashboard_access_level, module_access, is_active,
          sort_order, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14::text[],
               $15, $16, $17)
       ON CONFLICT (id) DO UPDATE SET
         name                   = EXCLUDED.name,
         tier_level             = EXCLUDED.tier_level,
         billing_cycle          = EXCLUDED.billing_cycle,
         price_idr              = EXCLUDED.price_idr,
         price_yearly_idr       = EXCLUDED.price_yearly_idr,
         extra_outlet_price_idr = EXCLUDED.extra_outlet_price_idr,
         currency               = EXCLUDED.currency,
         features               = EXCLUDED.features,
         product_limit          = EXCLUDED.product_limit,
         max_outlets            = EXCLUDED.max_outlets,
         ai_quota_monthly       = EXCLUDED.ai_quota_monthly,
         dashboard_access_level = EXCLUDED.dashboard_access_level,
         module_access          = EXCLUDED.module_access,
         is_active              = EXCLUDED.is_active,
         sort_order             = EXCLUDED.sort_order,
         updated_by             = EXCLUDED.updated_by,
         updated_at             = CURRENT_TIMESTAMP
       RETURNING ${KOLOM}`,
      [
        masukan.id,
        masukan.name.trim(),
        masukan.tierLevel,
        masukan.billingCycle,
        masukan.priceIdr,
        masukan.priceYearlyIdr,
        masukan.extraOutletPriceIdr,
        masukan.currency || 'IDR',
        JSON.stringify(masukan.features ?? []),
        masukan.productLimit,
        masukan.maxOutlets,
        masukan.aiQuotaMonthly,
        masukan.dashboardAccessLevel,
        masukan.moduleAccess,
        masukan.isActive,
        masukan.sortOrder ?? masukan.tierLevel,
        aktor,
      ]
    );

    const sesudah = keAdminPlan(rows[0]);
    const kind = sebelum ? 'UPDATE' : 'CREATE';

    await c.query(
      `INSERT INTO billing.plan_change_log (plan_id, changed_by, change_kind, before_json, after_json)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [sesudah.id, aktor, kind, sebelum ? JSON.stringify(sebelum) : null, JSON.stringify(sesudah)]
    );

    return { plan: sesudah, kind };
  });
}

/**
 * Menyalakan atau memadamkan satu paket.
 *
 * Paket TIDAK PERNAH dihapus, hanya dinonaktifkan. Menghapusnya akan memutus
 * `subscriptions.plan_id` milik merchant yang sedang memakainya — dan merchant
 * yang membayar tiba-tiba tidak punya paket. Yang dinonaktifkan hilang dari
 * kartu harga tapi tetap berlaku bagi yang sudah terlanjur berlangganan.
 */
export async function ubahAktifPaket(
  db: Db,
  planId: string,
  aktif: boolean,
  aktor: string
): Promise<AdminPlan | null> {
  return db.tx(async (c) => {
    const lama = await c.query(`SELECT ${KOLOM} FROM billing.plans WHERE id = $1`, [planId]);
    if (!lama.rows.length) return null;
    const sebelum = keAdminPlan(lama.rows[0]);

    const { rows } = await c.query(
      `UPDATE billing.plans
          SET is_active = $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING ${KOLOM}`,
      [planId, aktif, aktor]
    );
    const sesudah = keAdminPlan(rows[0]);

    await c.query(
      `INSERT INTO billing.plan_change_log (plan_id, changed_by, change_kind, before_json, after_json)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [
        planId,
        aktor,
        aktif ? 'ACTIVATE' : 'DEACTIVATE',
        JSON.stringify(sebelum),
        JSON.stringify(sesudah),
      ]
    );

    return sesudah;
  });
}

/**
 * Membaca masukan mentah dari HTTP menjadi bentuk yang bertipe.
 *
 * Semua konversi angka terjadi di sini. Formulir HTML mengirim string, dan
 * `"99000" > 50000` di JavaScript bernilai false — perbandingan batas yang
 * membandingkan string adalah cara paling sunyi untuk kehilangan penegakan.
 */
export function bacaMasukanPaket(body: any): AdminPlan {
  const angka = (v: unknown, bawaan = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : bawaan;
  };
  const angkaAtauNull = (v: unknown) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    id: String(body?.id ?? '').trim().toLowerCase(),
    name: String(body?.name ?? '').trim(),
    tierLevel: angka(body?.tierLevel, 1),
    billingCycle: body?.billingCycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
    priceIdr: angka(body?.priceIdr),
    priceYearlyIdr: angkaAtauNull(body?.priceYearlyIdr),
    extraOutletPriceIdr: angkaAtauNull(body?.extraOutletPriceIdr),
    currency: String(body?.currency ?? 'IDR'),
    features: Array.isArray(body?.features)
      ? body.features.map((f: unknown) => String(f).trim()).filter(Boolean).slice(0, 20)
      : [],
    productLimit: angka(body?.productLimit, -1),
    maxOutlets: angka(body?.maxOutlets, 1),
    aiQuotaMonthly: angka(body?.aiQuotaMonthly, 0),
    dashboardAccessLevel: (body?.dashboardAccessLevel ?? 'BASIC') as DashboardAccessLevel,
    moduleAccess: Array.isArray(body?.moduleAccess)
      ? (Array.from(new Set(body.moduleAccess.map((m: unknown) => String(m)))) as PermissionFeature[])
      : [],
    isActive: body?.isActive !== false,
    sortOrder: angka(body?.sortOrder, angka(body?.tierLevel, 1)),
  };
}
