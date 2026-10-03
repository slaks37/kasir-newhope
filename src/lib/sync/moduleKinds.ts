import type {WorkspaceModule} from '../navigation/routes';
const core=['store_settings','users'] as const;
const kinds:Record<WorkspaceModule,string[]>={
  overview:[],
  pos:['products','categories','tables','customers','promo_codes','bundles','held_orders','order_operations','staff_members'],
  inventory:['products','categories','stock_items','inventory_logs','bundles'],
  customers:['customers','sent_lifecycle_hooks'],
  tables:['tables','order_operations','kds_tickets','carwash_queue','bookings'],
  reports:['products','categories'],ai:['products','categories','stock_items','customers','sent_lifecycle_hooks'],
  labor:['staff_members','attendance_logs','commission_rules','payroll_slips'],
  settings:['staff_members'],payment:[],businesses:[],
};
export function kindsForModule(module:WorkspaceModule){return [...core,...kinds[module]];}
