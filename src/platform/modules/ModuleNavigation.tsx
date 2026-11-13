import {useWorkspaceBusiness} from '../../context/WorkspaceBusinessContext';
import React from 'react';
import { useBusinessModule } from './ModuleWorkspaceGate';
import { effectivePages } from './registry';
import { modulePath, parseModuleRoute } from './routing';
import { navigate, useWorkspaceRoute } from '../../lib/navigation/workspaceRouter';
import { usePOSFields } from '../../context/POSDomains';
import type { PermissionFeature } from '../../types';
export function ModuleNavigation({ mobile = false }: { mobile?: boolean }) {
  const runtime = useBusinessModule();const workspace=useWorkspaceBusiness();
  const { hasPermission, settings, activeTab } = usePOSFields(['hasPermission','settings','activeTab']);
  const route = parseModuleRoute(useWorkspaceRoute());
  if (!runtime) return null;
  const { manifest, grant, access } = runtime;
  const pages = effectivePages(manifest, grant, p => hasPermission(p as PermissionFeature) && settings.enabledModules?.[p as PermissionFeature] !== false);
  return <nav aria-label={'Navigasi ' + manifest.name} className={mobile ? 'lg:hidden flex gap-2 overflow-x-auto border-t bg-white p-3' : 'nh-sidebar-nav'}>
    {grant.workspaceVersion===2&&<label className="block p-2 text-sm">Modul<select aria-label="Pilih modul bisnis" className="block rounded border p-2" value={manifest.id} onChange={e=>{const target=access.modules.find(m=>m.id===e.target.value);if(!target)return;workspace.select(access.businessId,access.outletId);navigate(modulePath(access.businessId,access.outletId,target.id,'dashboard'));}}>{access.modules.filter(m=>m.permissions.includes('overview')&&m.features.includes('overview')).map(m=><option key={m.id} value={m.id}>{m.id}</option>)}</select></label>}
    {!mobile && <p className="nh-sidebar-caption">{manifest.name}</p>}
    {pages.map(page => <button key={page.id} aria-current={(route ? route.page.id === page.id : activeTab === page.tab) ? 'page' : undefined}
      className={mobile ? 'shrink-0 rounded-xl border px-4 py-2' : 'nh-sidebar-item'}
      onClick={() => navigate(modulePath(access.businessId, access.outletId, manifest.id, page.id))}>{page.label}</button>)}
  </nav>;
}
