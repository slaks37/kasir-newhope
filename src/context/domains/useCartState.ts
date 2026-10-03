import {useState,useLayoutEffect} from 'react';
import type {Product,ProductVariant,SelectedModifier,Customer,Table,StaffMember,OrderType} from '../../types';
import {addCartItem,quantityCartItem,discountCartItem,emptyCartDraft,readCartDraft,type CartDraft} from '../../lib/workspace/cart';
import {playPOSSound} from '../../utils/formatters';

/** Cart owns its draft and selection lifecycle, not transaction persistence.
 * The payment orchestrator must durably enqueue before clearing this domain. */
export function useCartState(options:{key:string;registerSwitchGuard:(guard:()=>void)=>()=>void;onPersistenceError:()=>void;canAdd:(product:Product)=>boolean}){
  const [initial]=useState(()=>{try{return {draft:readCartDraft(localStorage.getItem(options.key)),valid:true};}catch{return {draft:emptyCartDraft(),valid:false};}});
  const [cart,setCart]=useState(initial.draft.items);
  const [selectedCustomer,setSelectedCustomer]=useState<Customer|null>(initial.draft.customer);
  const [selectedTable,setSelectedTable]=useState<Table|null>(initial.draft.table);
  const [selectedStaff,setSelectedStaff]=useState<StaffMember|null>(initial.draft.staff);
  const [orderType,setOrderType]=useState<OrderType>(initial.draft.orderType);
  const [selectedCategory,setSelectedCategory]=useState('all'),[searchQuery,setSearchQuery]=useState('');
  const [soundEnabled,setSoundEnabled]=useState(true);
  useLayoutEffect(()=>{
    const save=()=>{
      // Never replace a malformed original draft with an empty fallback.
      if(!initial.valid)throw Error('CART_DRAFT_INVALID');
      const draft:CartDraft={version:2,items:cart,customer:selectedCustomer,table:selectedTable,staff:selectedStaff,orderType};
      const raw=JSON.stringify(draft);if(localStorage.getItem(options.key)!==raw)localStorage.setItem(options.key,raw);
    };
    try{save();}catch{options.onPersistenceError();}
    return options.registerSwitchGuard(save);
  },[options.key,options.registerSwitchGuard,initial.valid,cart,selectedCustomer,selectedTable,selectedStaff,orderType]);
  const addToCart=(product:Product,variant?:ProductVariant,modifiers:SelectedModifier[]=[],quantity=1,notes='')=>{
    if(!options.canAdd(product))return;
    if(soundEnabled)playPOSSound('add_item');
    setCart(previous=>addCartItem(previous,product,variant,modifiers,quantity,notes));
  };
  const removeFromCart=(id:string)=>{if(soundEnabled)playPOSSound('delete');setCart(previous=>previous.filter(item=>item.id!==id));};
  const updateCartQuantity=(id:string,quantity:number)=>{if(quantity<=0&&soundEnabled)playPOSSound('delete');setCart(previous=>quantityCartItem(previous,id,quantity));};
  const updateCartItemNotes=(id:string,notes:string)=>setCart(previous=>previous.map(item=>item.id===id?{...item,itemNotes:notes}:item));
  const applyCartItemDiscount=(id:string,percent:number,amount:number)=>setCart(previous=>discountCartItem(previous,id,percent,amount));
  const clearCart=()=>{setCart([]);setSelectedCustomer(null);setSelectedTable(null);setSelectedStaff(null);};
  const toggleSound=()=>setSoundEnabled(previous=>!previous);
  return {cart,setCart,selectedCustomer,setSelectedCustomer,selectedTable,setSelectedTable,selectedStaff,setSelectedStaff,
    orderType,setOrderType,selectedCategory,setSelectedCategory,searchQuery,setSearchQuery,soundEnabled,
    addToCart,removeFromCart,updateCartQuantity,updateCartItemNotes,applyCartItemDiscount,clearCart,toggleSound};
}
