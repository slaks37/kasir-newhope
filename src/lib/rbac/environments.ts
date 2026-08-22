/**
 * THREE-ENVIRONMENT ROUTING & RBAC
 * ================================
 *
 *   pos.domainanda.com      FRONT_OFFICE   cashier terminal, speed-critical
 *   app.domainanda.com      MERCHANT_BO    owner/manager back-office
 *   admin.domainanda.com    PROVIDER_BO    our own staff
 *
 * Two separate identity planes, and the distinction is the whole point:
 *
 *   MERCHANT identities  (`users` table)          -> FRONT_OFFICE, MERCHANT_BO
 *   INTERNAL identities  (`internal_users` table) -> PROVIDER_BO only
 *
 * A merchant role can never reach PROVIDER_BO and an internal role never
 * authenticates against a merchant environment. That is enforced structurally —
 * the two role unions do not overlap and `environmentsForRole` has no entry that
 * spans planes — rather than by a runtime `if` someone can forget.
 */

/* -------------------------------------------------------------------------- */
/* Environments                                                               */
/* -------------------------------------------------------------------------- */

export type AppEnvironment = 'FRONT_OFFICE' | 'MERCHANT_BO' | 'PROVIDER_BO';

export interface EnvironmentSpec {
  id: AppEnvironment;
  /** Default production hostname. */
  host: string;
  label: string;
  identityPlane: 'MERCHANT' | 'INTERNAL';
  /** Performance budget for the primary interaction, in milliseconds. */
  latencyBudgetMs: number;
  offlineFirst: boolean;
}

export const ENVIRONMENTS: Record<AppEnvironment, EnvironmentSpec> = {
  FRONT_OFFICE: {
    id: 'FRONT_OFFICE',
    host: 'pos.domainanda.com',
    label: 'Kasir (POS)',
    identityPlane: 'MERCHANT',
    latencyBudgetMs: 100,
    offlineFirst: true,
  },
  MERCHANT_BO: {
    id: 'MERCHANT_BO',
    // The spec left this domain blank; `app.` is the conventional pair for
    // `pos.` and `admin.`. Change here if you prefer another host.
    host: 'app.domainanda.com',
    label: 'Back-Office Merchant',
    identityPlane: 'MERCHANT',
    latencyBudgetMs: 1000,
    offlineFirst: false,
  },
  PROVIDER_BO: {
    id: 'PROVIDER_BO',
    host: 'admin.domainanda.com',
    label: 'Back-Office Internal',
    identityPlane: 'INTERNAL',
    latencyBudgetMs: 2000,
    offlineFirst: false,
  },
};

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

/** Merchant-side roles. Stored in `users.role`. */
export type MerchantRole = 'ROLE_MERCHANT_OWNER' | 'ROLE_MANAGER' | 'ROLE_CASHIER' | 'ROLE_STAFF';

/** Provider-side roles. Stored in `internal_users.role`. Never in `users`. */
export type InternalRole = 'ROLE_SUPERADMIN' | 'ROLE_INTERNAL_GROWTH' | 'ROLE_INTERNAL_SUPPORT';

export type PlatformRole = MerchantRole | InternalRole;

export const INTERNAL_ROLES: InternalRole[] = [
  'ROLE_SUPERADMIN',
  'ROLE_INTERNAL_GROWTH',
  'ROLE_INTERNAL_SUPPORT',
];

export function isInternalRole(role: string): role is InternalRole {
  return (INTERNAL_ROLES as string[]).includes(role);
}

/**
 * Bridge to the roles already stored in this app (`ADMIN | MANAGER | CASHIER`).
 *
 * The existing values are NOT renamed: they are persisted in every merchant's
 * localStorage and in `users.role`, so a rename would lock people out of their
 * own accounts on deploy. This maps old -> new at the boundary instead.
 */
export function toPlatformRole(legacy: 'ADMIN' | 'MANAGER' | 'CASHIER'): MerchantRole {
  switch (legacy) {
    case 'ADMIN':
      return 'ROLE_MERCHANT_OWNER';
    case 'MANAGER':
      return 'ROLE_MANAGER';
    case 'CASHIER':
    default:
      return 'ROLE_CASHIER';
  }
}

/* -------------------------------------------------------------------------- */
/* Role -> environment                                                        */
/* -------------------------------------------------------------------------- */

const ROLE_ENVIRONMENTS: Record<PlatformRole, AppEnvironment[]> = {
  // Cashier and floor staff get the terminal only. Explicitly NOT the merchant
  // back-office: the spec forbids them monthly revenue, margin and analytics,
  // and the reliable way to enforce that is to not serve them the app at all.
  ROLE_CASHIER: ['FRONT_OFFICE'],
  ROLE_STAFF: ['FRONT_OFFICE'],
  // Managers run the floor and the reports.
  ROLE_MANAGER: ['FRONT_OFFICE', 'MERCHANT_BO'],
  ROLE_MERCHANT_OWNER: ['FRONT_OFFICE', 'MERCHANT_BO'],
  // Internal staff never touch a merchant environment.
  ROLE_SUPERADMIN: ['PROVIDER_BO'],
  ROLE_INTERNAL_GROWTH: ['PROVIDER_BO'],
  ROLE_INTERNAL_SUPPORT: ['PROVIDER_BO'],
};

export function environmentsForRole(role: PlatformRole): AppEnvironment[] {
  return ROLE_ENVIRONMENTS[role] || [];
}

export function canAccessEnvironment(role: PlatformRole, env: AppEnvironment): boolean {
  return environmentsForRole(role).includes(env);
}

/** Where a role should land after signing in. */
export function landingEnvironment(role: PlatformRole): AppEnvironment | null {
  const envs = environmentsForRole(role);
  if (envs.length === 0) return null;
  // Merchant owners/managers land in the back-office; everyone else on their
  // only environment.
  if (envs.includes('MERCHANT_BO') && role !== 'ROLE_CASHIER' && role !== 'ROLE_STAFF') {
    return 'MERCHANT_BO';
  }
  return envs[0];
}

/* -------------------------------------------------------------------------- */
/* Internal capabilities                                                      */
/* -------------------------------------------------------------------------- */

export type InternalCapability =
  /* --- Agregat: tidak ada merchant yang bisa dikenali dari angkanya -------- */
  | 'VIEW_MERCHANT_HEALTH'
  | 'VIEW_CHURN_COHORT'
  | 'VIEW_PLATFORM_REVENUE'
  | 'VIEW_FEATURE_ADOPTION'
  | 'VIEW_SECTOR_ANALYTICS'
  | 'VIEW_ACCESS_AUDIT'

  /* --- Satu merchant yang teridentifikasi ---------------------------------
   *
   * DIPECAH DARI SATU `VIEW_MERCHANT_DETAIL`.
   *
   * Capability tunggal itu dulu membuka sekaligus: profil toko, omzet dan
   * marginnya, langganan dan tagihannya, serta pemakaian AI-nya. Keempatnya
   * punya tingkat kepekaan berbeda, dan menggabungkannya berarti staf yang
   * hanya perlu memeriksa nama cabang ikut membaca pembukuannya.
   *
   * Prinsipnya: yang butuh melihat profil tidak otomatis butuh melihat uang.
   */
  | 'VIEW_MERCHANT_PROFILE'
  | 'VIEW_MERCHANT_FINANCIAL'
  | 'VIEW_MERCHANT_BILLING'
  | 'VIEW_MERCHANT_AI_USAGE'
  | 'VIEW_TRANSACTION_LOG'
  | 'VIEW_PRODUCT_SALES'
  | 'VIEW_ACTIVITY_LOG'

  /* --- Data pribadi pelanggan merchant ------------------------------------
   *
   * Bukan data merchant, melainkan data ORANG yang berbelanja padanya. Nama,
   * nomor telepon, riwayat kunjungan. Merchant memegangnya sebagai pengendali
   * data; kami hanya pemroses. Membukanya tanpa alasan tertulis adalah persis
   * yang tidak boleh terjadi.
   */
  | 'VIEW_CUSTOMER_DATA'

  /* --- Mengubah keadaan, atau bertindak sebagai orang lain ---------------- */
  | 'MANAGE_SUBSCRIPTION'
  | 'GRANT_AI_CREDITS'
  | 'IMPERSONATE_MERCHANT'
  // Membuat, menonaktifkan, dan mengubah peran akun internal. Kemampuan paling
  // berbahaya di sistem ini: siapa pun yang memilikinya bisa memberi dirinya
  // sendiri kemampuan lain. Hanya SUPERADMIN.
  | 'MANAGE_INTERNAL_USERS'
  // Menulis dan menerbitkan artikel di situs publik. Bukan kemampuan analitik:
  // yang memilikinya mengubah apa yang dibaca calon pelanggan di halaman depan.
  | 'MANAGE_PUBLIC_CONTENT';

/* -------------------------------------------------------------------------- */
/* Kepekaan sumber daya                                                       */
/* -------------------------------------------------------------------------- */

/**
 * SEBERAPA PEKA yang dibuka sebuah capability — bukan siapa yang membukanya.
 *
 * MASALAH YANG DIPERBAIKI. Kewajiban menyertakan alasan dulu ditentukan
 * SEMATA oleh peran:
 *
 *     requiresJustification = role === 'ROLE_INTERNAL_SUPPORT' && requiresAudit(cap)
 *
 * Artinya superadmin membuka data pribadi pelanggan tanpa perlu menyebut
 * alasan apa pun, sementara support harus beralasan untuk melihat daftar
 * cabang. Peran menjawab "boleh atau tidak"; ia tidak menjawab "seberapa
 * berbahaya kalau ini dibuka tanpa sebab". Yang kedua melekat pada DATANYA,
 * dan tidak berubah karena siapa yang membukanya.
 */
export type Sensitivity =
  /** Tidak ada merchant yang bisa dikenali. Tidak dicatat, tidak perlu alasan. */
  | 'AGGREGATE'
  /** Satu merchant, bukan uang dan bukan data pribadi. */
  | 'IDENTIFIED'
  /** Pembukuan satu merchant: omzet, margin, tagihan, struk. */
  | 'FINANCIAL'
  /** Data pribadi pelanggan merchant. */
  | 'PERSONAL'
  /** Mengubah siapa boleh apa, atau bertindak atas nama orang lain. */
  | 'DANGEROUS';

const SENSITIVITY: Record<InternalCapability, Sensitivity> = {
  VIEW_MERCHANT_HEALTH:   'AGGREGATE',
  VIEW_CHURN_COHORT:      'AGGREGATE',
  VIEW_PLATFORM_REVENUE:  'AGGREGATE',
  VIEW_FEATURE_ADOPTION:  'AGGREGATE',
  VIEW_SECTOR_ANALYTICS:  'AGGREGATE',
  // Log akses dibaca untuk MENGAWASI, dan pengawasan yang sendirinya perlu
  // izin khusus cenderung tidak dilakukan. Isinya pun bukan data merchant.
  VIEW_ACCESS_AUDIT:      'AGGREGATE',

  VIEW_MERCHANT_PROFILE:  'IDENTIFIED',
  VIEW_ACTIVITY_LOG:      'IDENTIFIED',

  VIEW_MERCHANT_FINANCIAL:'FINANCIAL',
  VIEW_MERCHANT_BILLING:  'FINANCIAL',
  VIEW_MERCHANT_AI_USAGE: 'FINANCIAL',
  VIEW_TRANSACTION_LOG:   'FINANCIAL',
  VIEW_PRODUCT_SALES:     'FINANCIAL',

  VIEW_CUSTOMER_DATA:     'PERSONAL',

  MANAGE_SUBSCRIPTION:    'DANGEROUS',
  GRANT_AI_CREDITS:       'DANGEROUS',
  IMPERSONATE_MERCHANT:   'DANGEROUS',
  MANAGE_INTERNAL_USERS:  'DANGEROUS',
  MANAGE_PUBLIC_CONTENT:  'DANGEROUS',
};

export function sensitivity(cap: InternalCapability): Sensitivity {
  return SENSITIVITY[cap] ?? 'DANGEROUS';   // tidak dikenal = perlakukan terburuk
}

const INTERNAL_CAPABILITIES: Record<InternalRole, InternalCapability[]> = {
  ROLE_SUPERADMIN: [
    'VIEW_MERCHANT_HEALTH',
    'VIEW_CHURN_COHORT',
    'VIEW_PLATFORM_REVENUE',
    'VIEW_FEATURE_ADOPTION',
    'VIEW_SECTOR_ANALYTICS',
    'VIEW_ACCESS_AUDIT',
    'VIEW_MERCHANT_PROFILE',
    'VIEW_MERCHANT_FINANCIAL',
    'VIEW_MERCHANT_BILLING',
    'VIEW_MERCHANT_AI_USAGE',
    'VIEW_TRANSACTION_LOG',
    'VIEW_PRODUCT_SALES',
    'VIEW_ACTIVITY_LOG',
    'VIEW_CUSTOMER_DATA',
    'MANAGE_SUBSCRIPTION',
    'GRANT_AI_CREDITS',
    'IMPERSONATE_MERCHANT',
    'MANAGE_INTERNAL_USERS',
    'MANAGE_PUBLIC_CONTENT',
  ],
  // Growth bekerja pada kohor dan agregat. SENGAJA tidak diberi capability
  // apa pun yang membidik satu merchant: menganalisis retensi tidak menuntut
  // membaca pembukuan satu toko yang bernama.
  ROLE_INTERNAL_GROWTH: [
    'VIEW_MERCHANT_HEALTH',
    'VIEW_CHURN_COHORT',
    'VIEW_PLATFORM_REVENUE',
    'VIEW_FEATURE_ADOPTION',
    'VIEW_SECTOR_ANALYTICS',
  ],
  // Support menangani satu merchant pada satu waktu. Mendapat profil dan
  // pembukuan yang diperlukan untuk menjawab keluhan, TAPI tidak data pribadi
  // pelanggan merchant, tidak boleh mengubah langganan, dan tidak melihat uang
  // seluruh platform.
  ROLE_INTERNAL_SUPPORT: [
    'VIEW_MERCHANT_HEALTH',
    'VIEW_MERCHANT_PROFILE',
    'VIEW_MERCHANT_FINANCIAL',
    'VIEW_MERCHANT_BILLING',
    'VIEW_MERCHANT_AI_USAGE',
    'VIEW_TRANSACTION_LOG',
    'VIEW_PRODUCT_SALES',
    'VIEW_ACTIVITY_LOG',
  ],
};

export function internalCapabilities(role: InternalRole): InternalCapability[] {
  return INTERNAL_CAPABILITIES[role] || [];
}

export function hasInternalCapability(role: string, cap: InternalCapability): boolean {
  if (!isInternalRole(role)) return false;
  return internalCapabilities(role).includes(cap);
}

/**
 * Capabilities that read one identified merchant's private data and therefore
 * MUST write an `internal_access_log` row.
 */
/**
 * Diaudit bila BUKAN agregat.
 *
 * Dulu daftar yang ditulis tangan. Daftar tangan punya satu sifat buruk yang
 * tidak menimbulkan galat: capability baru tidak masuk ke sana kecuali ada
 * yang ingat. Ia menua ke arah yang salah — makin banyak yang tidak tercatat,
 * dan tidak ada yang memberi tahu.
 *
 * Sekarang diturunkan dari kepekaannya. Capability baru harus punya entri di
 * SENSITIVITY (TypeScript menolak Record yang tidak lengkap), dan apa pun yang
 * bukan AGGREGATE otomatis tercatat.
 */
export function requiresAudit(cap: InternalCapability): boolean {
  return sensitivity(cap) !== 'AGGREGATE';
}

/** Daftar yang dihasilkan, bukan yang ditulis tangan. Dipakai dokumentasi dan tes. */
export const AUDITED_CAPABILITIES: InternalCapability[] =
  (Object.keys(SENSITIVITY) as InternalCapability[]).filter(requiresAudit);

/**
 * Kapan alasan tertulis wajib disertakan.
 *
 * Ditentukan KEPEKAAN DATANYA lebih dulu, baru perannya:
 *
 *   PERSONAL   selalu — termasuk superadmin. Data pribadi pelanggan merchant
 *              bukan milik kami, dan "saya bosnya" bukan alasan membukanya.
 *   DANGEROUS  selalu. Menyalakan langganan, memberi kredit, menyamar sebagai
 *              merchant, mengubah peran orang — semuanya harus punya sebab
 *              yang tertulis sebelum, bukan penjelasan yang dicari sesudah.
 *   FINANCIAL  hanya SUPPORT. Superadmin memang mengurus pembukuan platform;
 *              menuntutnya beralasan setiap kali hanya melatih mengetik "cek".
 *   IDENTIFIED hanya SUPPORT.
 *   AGGREGATE  tidak pernah.
 */
export function requiresJustification(role: InternalRole, cap: InternalCapability): boolean {
  const s = sensitivity(cap);
  if (s === 'AGGREGATE') return false;
  if (s === 'PERSONAL' || s === 'DANGEROUS') return true;
  return role === 'ROLE_INTERNAL_SUPPORT';
}

/* -------------------------------------------------------------------------- */
/* Host resolution                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Maps a request host to its environment.
 *
 * Localhost resolves to MERCHANT_BO so the single dev server keeps behaving the
 * way it does today; `?env=` overrides it for local testing of the other two.
 * Returns null for an unknown host — the caller must refuse rather than guess,
 * because guessing wrong would serve the internal console on a merchant domain.
 */
export function resolveEnvironment(host: string | undefined, override?: string): AppEnvironment | null {
  if (override) {
    const up = override.toUpperCase();
    if (up in ENVIRONMENTS) return up as AppEnvironment;
    return null;
  }
  if (!host) return null;
  const h = host.toLowerCase().split(':')[0];

  if (h.startsWith('pos.')) return 'FRONT_OFFICE';
  if (h.startsWith('admin.')) return 'PROVIDER_BO';
  if (h.startsWith('app.')) return 'MERCHANT_BO';

  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')) return 'MERCHANT_BO';

  return null;
}
