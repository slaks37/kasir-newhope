/** Shared client/API scope checks. Never infer sector from a product's name. */
export const operationalKinds=new Set(['categories','products','tables','customers','order_operations','held_orders','inventory_logs',
  'promo_codes','stock_items','bundles','attendance_logs','kds_tickets','carwash_queue','bookings','commission_rules',
  'payroll_slips','sent_lifecycle_hooks','store_settings','users','staff_members']);
const sectors=new Set(['FNB','LAUNDRY','RETAIL','CARWASH','BARBERSHOP']);
const presets:Record<string,string>={fnb:'FNB',ld:'LAUNDRY',rt:'RETAIL',cw:'CARWASH',bb:'BARBERSHOP'};
/** Legacy preset IDs encode provenance, not names. UUID/custom IDs carry no
 * implied sector. Check references too, so a renamed product/table cannot hide
 * contamination. Financial kinds never enter this validator. */
function presetSector(kind:string,id:unknown):string|undefined {
  if(typeof id!=='string')return;
  const pattern=kind==='products'?/^prod-(fnb|ld|rt|cw|bb)-\d+$/:
    kind==='categories'?/^cat-(fnb|ld|rt|cw|bb)-\d+$/:
    kind==='tables'?/^tbl-(ld|rt|cw|bb)-[md]?\d+$/:null;
  const match=pattern?.exec(id);
  if(match)return presets[match[1]];
  if(kind==='tables'&&/^tbl-\d+$/.test(id))return 'FNB';
}
export function operationalScopeIssue(owner:string,sector:string,kind:string,id:string,value:unknown,businessId=`${owner}_${sector}`):string|null {
  if(!operationalKinds.has(kind)||kind==='users'||kind==='staff_members')return null;
  const row=value&&typeof value==='object'?value as Record<string,unknown>:{};
  if(kind==='store_settings'&&typeof row.storeMode==='string'){
    const expected=sector==='FNB'?'FNB':sector==='RETAIL'?'RETAIL':'SERVICE';
    if(row.storeMode!==expected)return 'WRONG_STORE_MODE:'+row.storeMode;
  }
  for(const field of ['businessSector','sector']){
    if(typeof row[field]==='string'&&sectors.has(row[field] as string)&&row[field]!==sector)return `WRONG_SECTOR:${row[field]}`;
  }
  if(typeof row.businessId==='string'&&row.businessId!==businessId)
    return 'WRONG_BUSINESS:'+row.businessId;
  const references:[string,unknown][]=[[kind,id],['products',row.productId],['categories',row.categoryId],['tables',row.tableId]];
  // Bundles, held carts and KDS contain product references, not financial rows.
  for(const field of ['items','recipeIngredients'])if(Array.isArray(row[field])){
    for(const item of row[field] as unknown[]){
      if(item&&typeof item==='object'){
        const value=item as Record<string,unknown>;
        references.push(['products',value.productId],['products',(value.product as Record<string,unknown>|undefined)?.id]);
      }
    }
  }
  for(const [kind,ref] of references){
    const source=presetSector(kind,ref);
    if(source&&source!==sector)return `WRONG_SECTOR:${source}`;
  }
  return null;
}
