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
  | 'VIEW_MERCHANT_HEALTH'
  | 'VIEW_CHURN_COHORT'
  | 'VIEW_PLATFORM_REVENUE'
  | 'VIEW_FEATURE_ADOPTION'
  | 'VIEW_MERCHANT_DETAIL'
  | 'MANAGE_SUBSCRIPTION'
  | 'GRANT_AI_CREDITS'
  | 'IMPERSONATE_MERCHANT'
  | 'VIEW_ACCESS_AUDIT'
  // Ringkasan lima sektor bisnis. Agregat murni — tidak ada merchant yang bisa
  // dikenali dari angkanya, jadi Growth boleh melihatnya.
  | 'VIEW_SECTOR_ANALYTICS'
  // Tiga di bawah ini membaca pembukuan merchant yang teridentifikasi: struk
  // per struk, produk apa yang laku, siapa memberi diskon berapa. Sama
  // sensitifnya dengan VIEW_MERCHANT_DETAIL dan diperlakukan sama — diaudit,
  // dan Growth tidak mendapatkannya.
  | 'VIEW_TRANSACTION_LOG'
  | 'VIEW_PRODUCT_SALES'
  | 'VIEW_ACTIVITY_LOG';

const INTERNAL_CAPABILITIES: Record<InternalRole, InternalCapability[]> = {
  ROLE_SUPERADMIN: [
    'VIEW_MERCHANT_HEALTH',
    'VIEW_CHURN_COHORT',
    'VIEW_PLATFORM_REVENUE',
    'VIEW_FEATURE_ADOPTION',
    'VIEW_MERCHANT_DETAIL',
    'MANAGE_SUBSCRIPTION',
    'GRANT_AI_CREDITS',
    'IMPERSONATE_MERCHANT',
    'VIEW_ACCESS_AUDIT',
    'VIEW_SECTOR_ANALYTICS',
    'VIEW_TRANSACTION_LOG',
    'VIEW_PRODUCT_SALES',
    'VIEW_ACTIVITY_LOG',
  ],
  // Growth works on cohorts and aggregates. Deliberately NOT given
  // VIEW_MERCHANT_DETAIL: analysing retention does not require reading one
  // named merchant's books.
  ROLE_INTERNAL_GROWTH: [
    'VIEW_MERCHANT_HEALTH',
    'VIEW_CHURN_COHORT',
    'VIEW_PLATFORM_REVENUE',
    'VIEW_FEATURE_ADOPTION',
    'VIEW_SECTOR_ANALYTICS',
  ],
  // Support troubleshoots one merchant at a time and may not see money
  // platform-wide or change a subscription.
  ROLE_INTERNAL_SUPPORT: [
    'VIEW_MERCHANT_HEALTH',
    'VIEW_MERCHANT_DETAIL',
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
export const AUDITED_CAPABILITIES: InternalCapability[] = [
  'VIEW_MERCHANT_DETAIL',
  'IMPERSONATE_MERCHANT',
  'MANAGE_SUBSCRIPTION',
  'GRANT_AI_CREDITS',
  'VIEW_TRANSACTION_LOG',
  'VIEW_PRODUCT_SALES',
  'VIEW_ACTIVITY_LOG',
];

export function requiresAudit(cap: InternalCapability): boolean {
  return AUDITED_CAPABILITIES.includes(cap);
}

/** Support must say why before reading a named merchant's data. */
export function requiresJustification(role: InternalRole, cap: InternalCapability): boolean {
  return role === 'ROLE_INTERNAL_SUPPORT' && requiresAudit(cap);
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
