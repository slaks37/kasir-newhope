import { manifest as fnb } from '../../modules/fnb/manifest';
import { manifest as retail } from '../../modules/retail/manifest';
import { manifest as laundry } from '../../modules/laundry/manifest';
import { manifest as carwash } from '../../modules/carwash/manifest';
import { manifest as barber } from '../../modules/barber/manifest';
import { isBusinessModuleId, type BusinessModuleManifest, type BusinessModuleId, type ModuleGrant } from './contracts';
export const moduleRegistry: Readonly<Record<BusinessModuleId, BusinessModuleManifest>> = Object.freeze({ fnb, retail, laundry, carwash, barber });
export function moduleManifest(id: unknown): BusinessModuleManifest | null {
  return isBusinessModuleId(id) ? moduleRegistry[id] : null;
}
/** Sector selects a compatibility adapter, never grants access or entitlements. */
export function legacyModuleForSector(sector: string): BusinessModuleManifest | null {
  return Object.values(moduleRegistry).find(m => m.sector === sector) || null;
}
export function effectivePages(manifest: BusinessModuleManifest, grant: ModuleGrant, permitted: (permission: string) => boolean) {
  return manifest.pages.filter(p => (!p.ownerOnly || grant.tenantOwner) && grant.permissions.includes(p.permission) && grant.features.includes(p.permission) && permitted(p.permission));
}
