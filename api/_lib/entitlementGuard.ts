/**
 * Penegakan modul dan level dashboard DI SERVER.
 *
 * KENAPA INI PERLU. Sampai sekarang keduanya hanya menyembunyikan tampilan:
 * ReportsDashboard tidak menggambar bagian laba rugi kalau paketnya bukan
 * ADVANCED, dan menu ditutup kalau modulnya tidak dibeli. Siapa pun yang
 * menyunting bundel JavaScript membukanya kembali dalam hitungan detik, dan
 * datanya tetap dikirim server apa adanya.
 *
 * Yang menjaga uang (batas produk, batas outlet, kuota AI) sudah ditegakkan di
 * server. Berkas ini menutup dua sisanya untuk endpoint yang menyajikan DATA
 * BERNILAI JUAL — bukan untuk semua endpoint, karena mengunci jalur jualan
 * berarti kasir berhenti bekerja saat langganan lewat sehari.
 */

import type pg from 'pg';
import {
  bolehPakaiModul,
  bolehLevelDashboard,
  ENTITLEMENT_DARURAT,
  type PlanEntitlements,
  type DashboardAccessLevel,
} from '../../src/lib/plans/entitlements.js';
import type { PermissionFeature } from '../../src/types.js';

/**
 * Entitlement yang BERLAKU untuk sebuah merchant.
 *
 * Dibaca dari contract.merchant_entitlements — view yang sama dengan penegakan
 * batas produk dan outlet, dan yang sudah menurunkan semuanya ke tingkat Free
 * begitu langganan mati. Membaca billing.plans langsung akan melewatkan
 * penurunan itu.
 */
export async function entitlementMerchant(
  db: pg.Pool,
  merchantId: string
): Promise<PlanEntitlements> {
  const { rows } = await db.query(
    `SELECT product_limit, max_outlets, ai_quota_effective,
            dashboard_access_level, module_access
       FROM contract.merchant_entitlements WHERE merchant_id = $1`,
    [merchantId]
  );

  // Tanpa baris langganan: entitlement darurat, BUKAN paket termahal. Sejak
  // 0024 keadaan ini seharusnya tidak ada lagi — tiap merchant baru langsung
  // mendapat trial — tapi bertahan tertutup lebih baik daripada mengandalkan
  // trigger yang mungkin dimatikan orang.
  if (!rows.length) return ENTITLEMENT_DARURAT;

  const r = rows[0];
  return {
    productLimit: Number(r.product_limit),
    maxOutlets: Number(r.max_outlets),
    aiQuotaMonthly: Number(r.ai_quota_effective),
    dashboardAccessLevel: r.dashboard_access_level as DashboardAccessLevel,
    moduleAccess: (r.module_access ?? []) as PermissionFeature[],
  };
}

export interface HasilJaga {
  boleh: boolean;
  entitlements: PlanEntitlements;
  alasan?: string;
}

/** Modul harus dibuka paket merchant. */
export async function jagaModul(
  db: pg.Pool,
  merchantId: string,
  modul: PermissionFeature
): Promise<HasilJaga> {
  const e = await entitlementMerchant(db, merchantId);
  return bolehPakaiModul(e, modul)
    ? { boleh: true, entitlements: e }
    : {
        boleh: false,
        entitlements: e,
        alasan: `Modul ini tidak termasuk paket Anda.`,
      };
}

/** Level dashboard harus mencakup yang diminta. */
export async function jagaDashboard(
  db: pg.Pool,
  merchantId: string,
  minimal: DashboardAccessLevel
): Promise<HasilJaga> {
  const e = await entitlementMerchant(db, merchantId);
  return bolehLevelDashboard(e, minimal)
    ? { boleh: true, entitlements: e }
    : {
        boleh: false,
        entitlements: e,
        alasan: `Laporan tingkat ${minimal} tidak termasuk paket Anda (saat ini ${e.dashboardAccessLevel}).`,
      };
}
