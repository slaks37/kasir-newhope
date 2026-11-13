import { moduleRouteCatalog } from './routeCatalog';
import { isBusinessModuleId } from './contracts';
import type { BusinessModuleId } from './contracts';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function parseModuleRoute(path: string) {
  const parts = path.split(/[?#]/)[0].replace(/\/$/, '').split('/');
  if (parts.length !== 6 || parts[1] !== 'app' || !uuid.test(parts[2]) || !uuid.test(parts[3])) return null;
  const moduleId = parts[4], pageId = parts[5];
  if (!isBusinessModuleId(moduleId) || !Object.hasOwn(moduleRouteCatalog[moduleId], pageId)) return null;
  return { businessId: parts[2], outletId: parts[3], moduleId, page: { id: pageId, tab: moduleRouteCatalog[moduleId][pageId] } };
}
export function modulePath(businessId: string, outletId: string, moduleId: BusinessModuleId, pageId: string) {
  const value = `/app/${businessId}/${outletId}/${moduleId}/${pageId}`;
  if (!parseModuleRoute(value)) throw Error('INVALID_MODULE_ROUTE');
  return value;
}
export function isModulePath(path: string) { return path.split(/[?#]/)[0] === '/app' || path.startsWith('/app/'); }
