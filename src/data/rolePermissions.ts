import { PermissionFeature, UserRole } from '../types';

// Kept in its own module (not inside POSContext.tsx) so that React Fast Refresh
// can hot-update the provider — a file that exports both components and plain
// constants forces a full module invalidation on every edit.
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
    'billing_subscription',
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
