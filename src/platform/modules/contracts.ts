import type { BusinessSector, PermissionFeature } from '../../types';
import type { WorkspaceModule } from '../../lib/navigation/routes';
export const MODULE_IDS = ['fnb', 'retail', 'laundry', 'carwash', 'barber'] as const;
export type BusinessModuleId = typeof MODULE_IDS[number];
export type ModulePage = { id: string; label: string; tab: WorkspaceModule; permission: PermissionFeature; ownerOnly?: boolean };
export interface BusinessModuleManifest {
  id: BusinessModuleId;
  name: string;
  sector: BusinessSector;
  pages: readonly ModulePage[];
  workflow: readonly string[];
  dependencies: readonly string[];
  integrations: readonly string[];
  settings: readonly string[];
  dashboardKinds: readonly string[];
  /** Existing adapters currently support their original sector only. */
  limitations: readonly string[];
  adapter: 'sector-native';
}
export type ModuleGrant = { id: BusinessModuleId; permissions: string[]; features: string[]; tenantOwner?: boolean };
export type ModuleAccess = { enabled: boolean; businessId: string; outletId: string; modules: ModuleGrant[] };
export function isBusinessModuleId(value: unknown): value is BusinessModuleId {
  return typeof value === 'string' && (MODULE_IDS as readonly string[]).includes(value);
}
