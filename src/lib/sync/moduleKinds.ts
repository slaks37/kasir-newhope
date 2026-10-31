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
const operationalKinds:Record<string,string[]>={
  FNB:['tables','order_operations','kds_tickets'],
  RETAIL:['tables'],
  LAUNDRY:['tables','order_operations','customers'],
  CARWASH:['tables','carwash_queue','staff_members'],
  BARBERSHOP:['tables','bookings','staff_members','products','categories'],
};
export function kindsForModule(module:WorkspaceModule,sector?:string){
  return [...core,...(module==='tables'&&sector?operationalKinds[sector]||kinds[module]:kinds[module])];
}
