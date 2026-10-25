import type { WorkspaceModule } from '../../lib/navigation/routes';
import type { BusinessModuleId } from './contracts';
// Kept deliberately small: public login/landing guards also parse these URLs.
// Manifests carry labels, dependencies and workflows behind the workspace split.
const shared = {
  dashboard: 'overview', pos: 'pos', inventory: 'inventory', customers: 'customers',
  labor: 'labor', reports: 'reports', 'group-reports': 'reports', ai: 'ai',
  settings: 'settings', payment: 'payment', businesses: 'businesses',
} as const;
export const moduleRouteCatalog: Readonly<Record<BusinessModuleId, Readonly<Record<string, WorkspaceModule>>>> = {
  fnb: { ...shared, operations: 'tables', tables: 'tables' },
  retail: { ...shared, operations: 'inventory' },
  laundry: { ...shared, operations: 'tables' },
  carwash: { ...shared, operations: 'tables' },
  barber: { ...shared, operations: 'tables' },
};
