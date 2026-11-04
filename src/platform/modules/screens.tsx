import { lazy } from 'react';
export const moduleScreens = {
  fnb: {
    dashboard: lazy(() => import('../../modules/fnb/Dashboard')),
    operations: lazy(() => import('../../components/tables/KitchenDisplaySystem').then(m => ({ default: m.KitchenDisplaySystem }))),
  },
  retail: {
    dashboard: lazy(() => import('../../modules/retail/Dashboard')),
    operations: lazy(() => import('../../components/inventory/InventoryManager').then(m => ({ default: m.InventoryManager }))),
  },
  laundry: {
    dashboard: lazy(() => import('../../modules/laundry/Dashboard')),
    operations: lazy(() => import('../../components/tables/LaundryPipelineView').then(m => ({ default: m.LaundryPipelineView }))),
  },
  carwash: {
    dashboard: lazy(() => import('../../modules/carwash/Dashboard')),
    operations: lazy(() => import('../../components/tables/CarwashPipelineView').then(m => ({ default: m.CarwashPipelineView }))),
  },
  barber: {
    dashboard: lazy(() => import('../../modules/barber/Dashboard')),
    operations: lazy(() => import('../../components/tables/BarbershopBookingView').then(m => ({ default: m.BarbershopBookingView }))),
  },
};
