import {useState} from 'react';
import type {StockItem,ProductBundle,InventoryLog} from '../../types';
import type {DomainLoader} from './useCatalogState';
import {newId} from '../../lib/ids';

/** Inventory owns material/bundle edits. Purchasing with cash is a separate
 * financial command coordinated by POS, never an inventory-side cash total. */
export function useInventoryState(load:DomainLoader,options:{sound:(kind:'click'|'delete')=>void;cashier:()=>string;appendLog:(log:InventoryLog)=>void}){
  const [stockItems,setStockItems]=useState<StockItem[]>(()=>load('stock_items',[]));
  const [bundles,setBundles]=useState<ProductBundle[]>(()=>load('bundles',[]));
  const saveStockItem=(item:StockItem)=>{setStockItems(previous=>previous.some(row=>row.id===item.id)?previous.map(row=>row.id===item.id?item:row):[item,...previous]);options.sound('click');};
  const deleteStockItem=(id:string)=>{setStockItems(previous=>previous.filter(row=>row.id!==id));options.sound('delete');};
  const saveBundle=(bundle:ProductBundle)=>{setBundles(previous=>previous.some(row=>row.id===bundle.id)?previous.map(row=>row.id===bundle.id?bundle:row):[bundle,...previous]);options.sound('click');};
  const deleteBundle=(id:string)=>{setBundles(previous=>previous.filter(row=>row.id!==id));options.sound('delete');};
  const toggleBundleAvailability=(id:string)=>{setBundles(previous=>previous.map(row=>row.id===id?{...row,isAvailable:!row.isAvailable}:row));options.sound('click');};
  const adjustStockItemQuantity=(id:string,qtyChange:number,reason:string)=>{
    if(!Number.isFinite(qtyChange))throw Error('INVALID_STOCK_QUANTITY');
    const target=stockItems.find(row=>row.id===id);if(!target)return;
    const timestamp=new Date().toISOString(),newStock=Math.max(0,target.stock+qtyChange);
    options.appendLog({id:newId('log'),productId:id,productName:target.name,type:qtyChange>=0?'IN':'OUT',
      quantity:Math.abs(qtyChange),previousStock:target.stock,newStock,reason:reason||'Penyesuaian Stok Bahan/WIP',timestamp,user:options.cashier()});
    setStockItems(previous=>previous.map(row=>row.id===id?{...row,stock:newStock,lastUpdated:timestamp}:row));options.sound('click');
  };
  return {stockItems,setStockItems,bundles,setBundles,saveStockItem,deleteStockItem,saveBundle,deleteBundle,toggleBundleAvailability,adjustStockItemQuantity};
}
