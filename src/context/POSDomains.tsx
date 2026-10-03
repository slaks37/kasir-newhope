import React,{createContext,useContext,useLayoutEffect,useRef,useSyncExternalStore} from 'react';
import type {POSContextType} from './POSContext';
import {SelectedStore} from './selectedStore';
const Context=createContext<SelectedStore<POSContextType>|null>(null);
export function POSDomainProvider({value,children}:{value:POSContextType;children:React.ReactNode}){
  const ref=useRef<SelectedStore<POSContextType>|null>(null);
  if(!ref.current)ref.current=new SelectedStore(value);
  const store=ref.current;
  useLayoutEffect(()=>store.publish(value),[store,value]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function usePOSFields<K extends keyof POSContextType>(keys:readonly K[]):Pick<POSContextType,K>{
  const store=useContext(Context);if(!store)throw new Error('POS domain must be used within POSProvider');
  return useSyncExternalStore(store.subscribe,()=>store.select(keys),()=>store.select(keys));
}
export function usePOSSnapshot(){
  const store=useContext(Context);if(!store)throw new Error('usePOS must be used within POSProvider');
  return useSyncExternalStore(store.subscribe,store.snapshot,store.snapshot);
}
export function useCatalog(){return usePOSFields(['products','categories','selectedCategory','setSelectedCategory','searchQuery','setSearchQuery','bundles','addToCart','settings']);}
export function useCart(){return usePOSFields(['cart','updateCartQuantity','removeFromCart','clearCart','applyCartItemDiscount','updateCartItemNotes','orderType','setOrderType','selectedCustomer','setSelectedCustomer','selectedTable','setSelectedTable','settings','shift','holdOrder','heldOrders','staffMembers','selectedStaff','setSelectedStaff']);}
export function useReportWorkspace(){return usePOSFields(['syncStatus','forceSync','cloudError','products','shift','shiftHistory','endShift','settings','currentUser','addCashMovement','deleteCashMovement','setInitialCash']);}
export function useWorkspaceShell(){return usePOSFields(['activeTab','setActiveTab','cart','addToCart','settings','currentUser','hasPermission']);}
