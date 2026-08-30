/**
 * Katalog paket langganan — SATU-SATUNYA definisi di seluruh repositori.
 *
 * MASALAH YANG DISELESAIKAN. Katalog ini pernah ditulis EMPAT KALI:
 *
 *   services/billing/index.ts        api/_gateway.ts
 *   api/v1/subscription/plans.ts     api/v1/subscription/checkout.ts
 *
 * dan literal harganya tersebar di dua belas berkas. Keempatnya kebetulan masih
 * sama nilainya — yang tidak ada adalah mekanisme apa pun yang menjaganya tetap
 * begitu. Perubahan harga menuntut dua belas suntingan terkoordinasi, dan satu
 * yang terlewat menghasilkan merchant ditagih berbeda dari yang ditampilkan
 * kepadanya: kelas kerusakan yang baru ketahuan lewat keluhan pelanggan.
 *
 * Duplikasinya lahir dari dua permukaan deployment yang tumbuh berdampingan —
 * microservice di `services/` dan serverless di `api/`. Keduanya sekarang
 * mengimpor berkas ini.
 *
 * `billing.plans` di database di-seed dari sini oleh billing-service saat
 * menyala (`store.pastikanPaket`), jadi urutan kebenarannya jelas:
 *
 *   berkas ini  ->  billing.plans  ->  GET /api/v1/subscription/plans  ->  UI
 *
 * Frontend TIDAK boleh menuliskan harga sendiri; ia membacanya dari endpoint
 * itu. Pemeriksa higiene (`scripts/dev/check-source-hygiene.mjs`) menolak
 * literal harga yang muncul di luar berkas ini.
 */

import type { SaaSPlan } from '../types';

export const SAAS_PLANS: SaaSPlan[] = [
  {
    id: 'plan-free',
    name: 'Free Tier',
    tierLevel: 1,
    billingCycle: 'MONTHLY',
    priceIdr: 0,
    currency: 'IDR',
    maxOutlets: 1,
    isActive: true,
    productLimit: 30,
    aiQuotaMonthly: 3,
    dashboardAccessLevel: 'BASIC',
    features: [
      'Basic POS & Transaksi',
      'Ringkasan Penjualan Harian',
      '1 Outlet / Cabang Toko',
      'Maksimal 30 Produk',
      'AI Analyst (3x / bulan)',
    ],
  },
  {
    id: 'plan-plus-monthly',
    name: 'Tier Plus',
    tierLevel: 2,
    billingCycle: 'MONTHLY',
    priceIdr: 99000,
    priceYearlyIdr: 79000,
    currency: 'IDR',
    maxOutlets: 2,
    isActive: true,
    productLimit: 100,
    aiQuotaMonthly: 30,
    dashboardAccessLevel: 'FULL',
    extraOutletPriceIdr: 59000,
    features: [
      'Full POS & Transaksi Kasir',
      'Manajemen Inventori Dasar',
      'Laporan & Dashboard Analytics',
      'Maksimal 100 Produk per Outlet',
      'Up to 2 Outlet Terdaftar',
      'AI Analyst (30x / bulan)',
    ],
  },
  {
    id: 'plan-pro-monthly',
    name: 'Tier Pro',
    tierLevel: 3,
    billingCycle: 'MONTHLY',
    priceIdr: 299000,
    priceYearlyIdr: 239000,
    currency: 'IDR',
    maxOutlets: 4,
    isActive: true,
    productLimit: -1, // Unlimited
    aiQuotaMonthly: 90,
    dashboardAccessLevel: 'ADVANCED',
    extraOutletPriceIdr: 49000,
    features: [
      'Full POS & Transaksi Lanjutan',
      'Manajemen Stok Lanjut & Bahan Baku',
      'Multi-Outlet Analytics & Laporan Lengkap',
      'Produk Tidak Terbatas (Unlimited)',
      'Up to 4 Outlet Terdaftar',
      'AI Analyst (90x / bulan)',
    ],
  },
];

/**
 * Paket tambahan AI Credit.
 *
 * Bukan paket langganan, tapi harga yang DITAMPILKAN ke merchant di layar
 * paywall Copilot — jadi ia tunduk pada aturan yang sama: satu tempat, bukan
 * angka yang mengambang di dalam handler.
 */
export const AI_CREDIT_ADDON = {
  priceIdr: 49000,
  credits: 50,
} as const;
