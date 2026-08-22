import { PermissionFeature, UserRole } from '../types';

// Kept in its own module (not inside POSContext.tsx) so that React Fast Refresh
// can hot-update the provider — a file that exports both components and plain
// constants forces a full module invalidation on every edit.
//
// SALINAN LURING DARI pos.role_permissions.
//
// Aplikasi kasir harus tetap melayani saat internet mati, jadi pemeriksaan izin
// tidak bisa menunggu jawaban server — tabel ini harus ada di perangkat. Yang
// TIDAK boleh terjadi adalah keduanya menyimpang diam-diam, jadi
// test/izin-peran.test.ts membandingkan berkas ini dengan isi tabelnya dan
// gagal kalau berbeda. Menambah izin berarti menyentuh keduanya; itu memang
// disengaja.
//
// Database adalah yang berwenang. Kalau keduanya berbeda, yang salah ini.
//
// MANAGER TIDAK PUNYA `billing_subscription`. Sebelum ini daftarnya persis sama
// dengan ADMIN — artinya menurunkan seseorang dari Admin ke Manajer tidak
// mengubah apa pun, dan salah satu dari dua peran itu hanya hiasan. Mengganti
// paket langganan adalah keputusan pemilik.
export const ROLE_PERMISSIONS: Record<UserRole, PermissionFeature[]> = {
  ADMIN: [
    'home',
    'overview',
    'pos',
    'tables',
    'inventory',
    'customers',
    'reports',
    'ai',
    'settings',
    'void_order',
    'stock_adjustment',
    'user_management',
    'billing_subscription',
  ],
  MANAGER: [
    'home',
    'overview',
    'pos',
    'tables',
    'inventory',
    'customers',
    'reports',
    'ai',
    'settings',
    'void_order',
    'stock_adjustment',
    'user_management',
  ],
  CASHIER: [
    'home',
    'overview',
    'pos',
    'tables',
    'customers',
    'ai',
  ],
};
