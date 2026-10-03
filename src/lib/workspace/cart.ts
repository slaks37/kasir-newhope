import type {CartItem,Customer,Table,StaffMember,OrderType,Product,ProductVariant,SelectedModifier} from '../../types';

export type CartDraft={version:2;items:CartItem[];customer:Customer|null;table:Table|null;staff:StaffMember|null;orderType:OrderType};
export function emptyCartDraft():CartDraft{return {version:2,items:[],customer:null,table:null,staff:null,orderType:'DINE_IN'};}
/** A cart draft is never a sale, ledger record or report source. Its key is
 * already bound to one verified business/outlet; malformed bytes stay intact. */
export function readCartDraft(raw:string|null):CartDraft{
  if(!raw)return emptyCartDraft();
  const value=JSON.parse(raw);
  const items=Array.isArray(value)?value:value?.version===2?value.items:null;
  if(!Array.isArray(items)||!items.every(item=>item&&typeof item.id==='string'&&typeof item.productId==='string'&&
    Number.isFinite(item.quantity)&&item.quantity>0&&Number.isFinite(item.unitPrice)&&item.unitPrice>=0&&
    Number.isFinite(item.totalPrice)&&item.totalPrice>=0))throw Error('CART_DRAFT_INVALID');
  const validSelection=(row:any)=>row===null||row&&typeof row.id==='string';
  if(!Array.isArray(value)&&(!validSelection(value.customer)||!validSelection(value.table)||!validSelection(value.staff)||
    !['DINE_IN','TAKEAWAY','DELIVERY','ONLINE'].includes(value.orderType)))throw Error('CART_DRAFT_INVALID');
  return Array.isArray(value)?{...emptyCartDraft(),items}:value;
}
function priced(item:CartItem,quantity=item.quantity,percent=item.discountPercent,amount=item.discountAmount):CartItem{
  const raw=item.unitPrice*quantity,discount=percent>0?raw*percent/100:amount;
  return {...item,quantity,discountPercent:percent,discountAmount:percent>0?discount:amount,totalPrice:Math.max(0,raw-discount)};
}
export function addCartItem(items:CartItem[],product:Product,variant?:ProductVariant,modifiers:SelectedModifier[]=[],quantity=1,notes=''):CartItem[]{
  if(!Number.isFinite(quantity)||quantity<=0)throw Error('INVALID_CART_QUANTITY');
  const unitPrice=product.price+(variant?.priceExtra||0)+modifiers.reduce((total,m)=>total+m.price,0);
  const id=`${product.id}-${variant?.id||'base'}-${modifiers.map(m=>m.optionId).sort().join('_')}`;
  const existing=items.find(item=>item.id===id);
  if(existing)return items.map(item=>item===existing?priced(item,item.quantity+quantity):item);
  return [...items,{id,productId:product.id,name:product.name,variantId:variant?.id,variantName:variant?.name,
    selectedModifiers:modifiers,unitPrice,unitCost:product.costPrice||0,quantity,itemNotes:notes,
    discountPercent:0,discountAmount:0,totalPrice:unitPrice*quantity}];
}
export function quantityCartItem(items:CartItem[],id:string,quantity:number){
  if(!Number.isFinite(quantity))throw Error('INVALID_CART_QUANTITY');
  return quantity<=0?items.filter(item=>item.id!==id):items.map(item=>item.id===id?priced(item,quantity):item);
}
export function discountCartItem(items:CartItem[],id:string,percent:number,amount:number){
  if(!Number.isFinite(percent)||percent<0||percent>100||!Number.isFinite(amount)||amount<0)throw Error('INVALID_CART_DISCOUNT');
  return items.map(item=>item.id===id?priced(item,item.quantity,percent,amount):item);
}
