/** Shared client/API scope checks. Never infer sector from a product's name. */
export const operationalKinds=new Set(['categories','products','tables','customers','order_operations','held_orders','inventory_logs',
  'promo_codes','stock_items','bundles','attendance_logs','kds_tickets','carwash_queue','bookings','commission_rules',
  'payroll_slips','sent_lifecycle_hooks','store_settings','users','staff_members']);
const sectors=new Set(['FNB','LAUNDRY','RETAIL','CARWASH','BARBERSHOP']);
const presets:Record<string,string>={fnb:'FNB',ld:'LAUNDRY',rt:'RETAIL',cw:'CARWASH',bb:'BARBERSHOP'};
export function operationalScopeIssue(owner:string,sector:string,kind:string,id:string,value:unknown):string|null {
  if(!operationalKinds.has(kind)||kind==='users'||kind==='staff_members')return null;
  const row=value&&typeof value==='object'?value as Record<string,unknown>:{};
  if(kind==='store_settings'&&typeof row.storeMode==='string'){
    const expected=sector==='FNB'?'FNB':sector==='RETAIL'?'RETAIL':'SERVICE';
    if(row.storeMode!==expected)return 'WRONG_STORE_MODE:'+row.storeMode;
  }
  for(const field of ['businessSector','sector']){
    if(typeof row[field]==='string'&&sectors.has(row[field] as string)&&row[field]!==sector)return `WRONG_SECTOR:${row[field]}`;
  }
  if(typeof row.businessId==='string'&&/_(FNB|LAUNDRY|RETAIL|CARWASH|BARBERSHOP)$/.test(row.businessId)&&row.businessId!==`${owner}_${sector}`)
    return 'WRONG_BUSINESS:'+row.businessId;
  const ref=kind==='products'?id:typeof row.productId==='string'?row.productId:'';
  const match=/^prod-(fnb|ld|rt|cw|bb)-\d+$/.exec(ref);
  if(match&&presets[match[1]]!==sector)return `WRONG_SECTOR:${presets[match[1]]}`;
  return null;
}
