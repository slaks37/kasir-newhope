import React, { createContext, useContext, useEffect, useState } from 'react';
import { useWorkspaceBusiness } from '../../context/WorkspaceBusinessContext';
import { useWorkspaceRoute, navigate } from '../../lib/navigation/workspaceRouter';
import { coalescedRead, refreshCoordinator } from '../../lib/sync/refreshCoordinator';
import { legacyModuleForSector, moduleManifest } from './registry';
import { isModulePath, parseModuleRoute } from './routing';
import type { BusinessModuleManifest, ModuleAccess, ModuleGrant } from './contracts';
type Runtime = { manifest: BusinessModuleManifest; grant: ModuleGrant; access: ModuleAccess };
const Context = createContext<Runtime | null>(null);
export const useBusinessModule = () => useContext(Context);
/** No operational store mounts for a foreign route or unverified module grant. */
export function ModuleWorkspaceGate({ children }: { children: React.ReactNode }) {
  const { business, outletId, directory, select } = useWorkspaceBusiness();
  const path = useWorkspaceRoute();
  const route = parseModuleRoute(path);
  const scoped = isModulePath(path);
  const recovery = ['/businesses','/subscription','/settings'].includes(path.split('?')[0]);
  const requested = scoped || !recovery && !!outletId && import.meta.env.VITE_MODULE_WORKSPACES === '1';
  const target = route?.moduleId || legacyModuleForSector(business.sector)?.id;
  const page = route?.page.id;
  const key = JSON.stringify([business.businessId, outletId, target, page]);
  const [state, setState] = useState<{ key: string; access?: ModuleAccess; error?: string }>({ key });
  const foreign = !!route && (route.businessId !== business.businessId || route.outletId !== outletId);
  useEffect(() => {
    if (!requested || foreign || !outletId || !target || scoped && !route) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ businessId: business.businessId, outletId });
    if (scoped) { params.set('moduleId', target); params.set('page', page!); }
    const url = '/api/v1/sync/modules/access?' + params;
    const run = async () => {
      try {
        const access = await coalescedRead(url, async () => {
          const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
          const result = await response.json();
          if (!response.ok || !result.ok) throw Error(result.error || 'MODULE_ACCESS_UNAVAILABLE');
          if (result.businessId !== business.businessId || result.outletId !== outletId || !Array.isArray(result.modules)) throw Error('MODULE_SCOPE_MISMATCH');
          return result as ModuleAccess;
        }, controller.signal);
        if (!controller.signal.aborted) setState(previous => previous.key === key && !previous.error && JSON.stringify(previous.access) === JSON.stringify(access) ? previous : { key, access });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : 'MODULE_ACCESS_UNAVAILABLE' });
      }
    };
    const off = refreshCoordinator.register('module-access:' + key, { run, interval: 120000, events: ['subscription-updated','outlets-updated'] });
    return () => { controller.abort(); off(); };
  }, [requested, foreign, key, scoped]);
  if (!requested) return <Context.Provider value={null}>{children}</Context.Provider>;
  if (scoped && (!route || foreign)) {
    const own = route && directory.businesses.find(b => b.businessId === route.businessId && b.status === 'ACTIVE' && b.outlets.some(o => o.outletId === route.outletId && o.status === 'ACTIVE'));
    return <main className="p-8 space-y-4"><p role="alert">Rute modul tidak sesuai dengan bisnis dan outlet yang dipilih.</p>
      {own && route && <button onClick={() => select(route.businessId, route.outletId)} className="border rounded-xl p-3">Pilih {own.name} dan outlet tujuan</button>}
      <button onClick={() => navigate('/businesses')} className="border rounded-xl p-3">Buka bisnis saya</button></main>;
  }
  if (!outletId || !target || state.key !== key || !state.access && !state.error) return <main role="status" className="p-8">Memverifikasi akses modul…</main>;
  if (state.error) return <main className="p-8 space-y-4"><p role="alert">Akses modul belum dapat diverifikasi: {state.error}. Antrean dan draf tetap disimpan.</p><button className="border rounded-xl p-3" onClick={() => navigate('/businesses')}>Kembali ke bisnis</button></main>;
  const grant = state.access?.modules.find(m => m.id === target);
  const manifest = moduleManifest(target);
  if (!state.access?.enabled || !grant || !manifest) {
    if (!scoped) return <Context.Provider value={null}>{children}</Context.Provider>;
    return <main role="alert" className="p-8">Modul belum diaktifkan untuk bisnis dan outlet ini.</main>;
  }
  return <Context.Provider value={{ manifest, grant, access: state.access }}>{children}</Context.Provider>;
}
