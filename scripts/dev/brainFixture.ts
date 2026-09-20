import { INITIAL_SETTINGS, INITIAL_SHIFT } from '../../src/data/initialData';
import { addDate } from '../../src/lib/assistant/periods';
import type { MerchantSnapshot } from '../../src/lib/assistant/types';
import type { Product, Order } from '../../src/types';
export const now=new Date('2026-09-17T10:00:00+07:00');
export const p:Product={id:'coffee',sku:'C',name:'Coffee',categoryId:'drink',price:10000,costPrice:4000,stock:1,minStockAlert:5,unit:'cup',isAvailable:true,targetMarginPercent:65};
export const order=(date:string,id:string,qty=1):Order=>({id,orderNumber:1,date,items:[{id:'line'+id,productId:p.id,name:p.name,selectedModifiers:[],unitPrice:10000,unitCost:4000,quantity:qty,discountPercent:0,discountAmount:0,totalPrice:10000*qty}],orderType:'DINE_IN',subtotal:10000*qty,discountTotal:0,taxTotal:1000*qty,serviceChargeTotal:0,total:11000*qty,paymentMethod:'CASH',paymentStatus:'PAID',cashierName:'Kasir',shiftId:'s',status:'COMPLETED'});
export const fixture:MerchantSnapshot={businessId:'audit_owner_FNB',merchantId:'audit_owner',tenantId:'audit',userRole:'ADMIN',generatedAt:now.toISOString(),businessSector:'FNB',storeName:'Test',slotNoun:'Meja',categories:[],products:[p],stockItems:[],inventoryLogs:[],orders:Array.from({length:100},(_,i)=>order(`${addDate('2026-09-17',-i-1)}T12:00:00+07:00`,'o'+i,10)),customers:[],tables:[],staff:[],attendance:[],shifts:[],currentShift:INITIAL_SHIFT,promoCodes:[],settings:{...INITIAL_SETTINGS,monthlyRevenueTarget:1e7}};
