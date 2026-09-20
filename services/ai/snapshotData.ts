import type { Db } from '../shared/db';
import type { AuthPrincipal } from '../shared/auth';
import type { MerchantSnapshot } from '../../src/lib/assistant/types';
import type { Order, Product } from '../../src/types';
import { INITIAL_SETTINGS } from '../../src/data/initialData';

/** Server-only: principal comes from verified Auth, never request body. The
 * loader enforces ownership itself before ANY transaction/catalog read. */
export async function loadMerchantSnapshot(db: Db, principal: AuthPrincipal, businessId: string, now = new Date()): Promise<MerchantSnapshot> {
  if(!principal?.subject||principal.subject==='local-development')throw new Error('AUTHENTICATION_REQUIRED');
  const merchant=(await db.query(`SELECT m.id,m.tenant_id,m.name,m.business_sector
    FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
    WHERE m.external_ref=$1 AND t.owner_user_ref=$2`,[businessId,principal.subject])).rows[0];
  if(!merchant)throw new Error('BUSINESS_NOT_OWNED');
  // Refuse excessive histories rather than silently truncate financial totals.
  const rows=(await db.query(`SELECT * FROM contract.transaction_log WHERE merchant_id=$1 AND created_at <= $2 ORDER BY created_at DESC LIMIT 50001`,[merchant.id,now.toISOString()])).rows;
  if(rows.length>50000)throw new Error('ANALYTICS_HISTORY_TOO_LARGE');
  const items=(await db.query(`SELECT item_id AS id,transaction_id,product_id,product_name,unit_price,unit_cost,quantity,discount_amount,total_price FROM contract.transaction_items_detailed WHERE merchant_id=$1 AND transaction_at <= $2`,[merchant.id,now.toISOString()])).rows;
  const catalog=(await db.query(`SELECT * FROM contract.intelligence_catalog WHERE merchant_id=$1 ORDER BY id`,[merchant.id])).rows;
  const targets=(await db.query(`SELECT monthly_revenue_target FROM contract.business_targets WHERE merchant_id=$1 AND outlet_id IS NULL AND target_type='MONTHLY_REVENUE' ORDER BY updated_at DESC LIMIT 1`,[merchant.id])).rows;
  const byOrder=new Map<string,any[]>();
  for(const item of items){const list=byOrder.get(item.transaction_id)||[];list.push(item);byOrder.set(item.transaction_id,list);}
  const orders: Order[]=rows.map((r,index)=>({id:r.id,orderNumber:index,date:new Date(r.created_at).toISOString(),
    items:(byOrder.get(r.id)||[]).map(i=>({id:i.id,productId:i.product_id,name:i.product_name,selectedModifiers:[],unitPrice:Number(i.unit_price),unitCost:i.unit_cost==null?undefined:Number(i.unit_cost),quantity:Number(i.quantity),discountPercent:0,discountAmount:Number(i.discount_amount||0),totalPrice:Number(i.total_price)})),
    orderType:r.order_type||'TAKEAWAY',subtotal:Number(r.subtotal),discountTotal:Number(r.discount_amount||0),taxTotal:Number(r.tax_amount||0),serviceChargeTotal:Number(r.service_charge_amount||0),total:Number(r.total_amount),
    paymentMethod:r.payment_method||'CASH',paymentStatus:r.payment_status||'PENDING',cashierName:r.cashier_name,shiftId:r.shift_id||'',
    status:r.order_status==='COMPLETED'&&r.payment_status==='PAID'?'COMPLETED':['VOID','CANCELLED'].includes(r.order_status)?'VOID':'HOLD'}));
  const products: Product[]=catalog.map(p=>({id:p.id,sku:p.sku||'',name:p.name,categoryId:p.category_name||'other',price:Number(p.price),costPrice:Number(p.cost_price),stock:Number(p.stock||0),minStockAlert:Number(p.min_stock_alert||0),unit:p.unit||'pcs',isAvailable:p.is_available,businessSector:merchant.business_sector}));
  return {businessId,merchantId:merchant.id,tenantId:merchant.tenant_id,userRole:'ADMIN',generatedAt:now.toISOString(),businessSector:merchant.business_sector,storeName:merchant.name,slotNoun:'Tempat',
    settings:{...INITIAL_SETTINGS,storeName:merchant.name,businessSector:merchant.business_sector,monthlyRevenueTarget:Number(targets[0]?.monthly_revenue_target)||undefined},
    orders,products,categories:[...new Set(products.map(p=>p.categoryId))].map(id=>({id,name:id,icon:'',color:''})),stockItems:[],inventoryLogs:[],customers:[],tables:[],staff:[],attendance:[],shifts:[],promoCodes:[],
    currentShift:{id:'',cashierName:'',startTime:now.toISOString(),initialCash:0,cashSales:0,qrisSales:0,cardSales:0,eWalletSales:0,totalSales:0,expectedCash:0,status:'CLOSED'}};
}
