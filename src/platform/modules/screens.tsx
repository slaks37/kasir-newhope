import React,{lazy} from 'react';
import {useBusinessModule} from './ModuleWorkspaceGate';
const WorkspaceOperations=lazy(()=>import('./WorkspaceOperations'));
function withWorkspaceOperations(Fallback:React.ComponentType){return function Operations(){const runtime=useBusinessModule();return runtime?.grant.workspaceVersion===2&&runtime.grant.capabilities?.includes('workflow.jobs')?<WorkspaceOperations/>:<Fallback/>;};}
export const moduleScreens = {
  fnb: {
    dashboard: lazy(() => import('../../modules/fnb/Dashboard')),
    operations: withWorkspaceOperations(lazy(() => import('../../components/tables/KitchenDisplaySystem').then(m => ({ default: m.KitchenDisplaySystem })))),
  },
  retail: {
    dashboard: lazy(() => import('../../modules/retail/Dashboard')),
    operations: lazy(() => import('../../components/inventory/InventoryManager').then(m => ({ default: m.InventoryManager }))),
  },
  laundry: {
    dashboard: lazy(() => import('../../modules/laundry/Dashboard')),
    operations: withWorkspaceOperations(lazy(() => import('../../components/tables/LaundryPipelineView').then(m => ({ default: m.LaundryPipelineView })))),
  },
  carwash: {
    dashboard: lazy(() => import('../../modules/carwash/Dashboard')),
    operations: withWorkspaceOperations(lazy(() => import('../../components/tables/CarwashPipelineView').then(m => ({ default: m.CarwashPipelineView })))),
  },
  barber: {
    dashboard: lazy(() => import('../../modules/barber/Dashboard')),
    operations: withWorkspaceOperations(lazy(() => import('../../components/tables/BarbershopBookingView').then(m => ({ default: m.BarbershopBookingView })))),
  },
};
