import {useMemo,useState} from 'react';
import type {Category,Product,Customer} from '../../types';

export type DomainLoader=<T>(kind:string,fallback:T)=>T;
export function useCatalogState(load:DomainLoader,onToggle:()=>void){
  const [categories,setCategories]=useState<Category[]>(()=>load('categories',[]));
  const [products,setProducts]=useState<Product[]>(()=>load('products',[]));
  const saveProduct=(product:Product)=>setProducts(previous=>{
    const index=previous.findIndex(row=>row.id===product.id);
    return index<0?[product,...previous]:previous.map((row,i)=>i===index?product:row);
  });
  const deleteProduct=(id:string)=>setProducts(previous=>previous.filter(row=>row.id!==id));
  const toggleProductAvailability=(id:string)=>{setProducts(previous=>previous.map(row=>row.id===id?{...row,isAvailable:!row.isAvailable}:row));onToggle();};
  const saveCategory=(category:Category)=>setCategories(previous=>previous.some(row=>row.id===category.id)?previous.map(row=>row.id===category.id?category:row):[...previous,category]);
  const deleteCategory=(id:string)=>{setCategories(previous=>previous.filter(row=>row.id!==id));setProducts(previous=>previous.map(row=>row.categoryId===id?{...row,categoryId:''}:row));};
  // Enrichment is O(products + categories) once per catalog change, not per
  // provider render. Sync traffic and cart keystrokes do not rebuild this map.
  const syncProducts=useMemo(()=>{
    const names=new Map(categories.map(category=>[category.id,category.name]));
    return products.map(product=>({...product,categoryName:names.get(product.categoryId)||'Lainnya'}));
  },[products,categories]);
  return {categories,setCategories,products,setProducts,syncProducts,saveProduct,deleteProduct,toggleProductAvailability,saveCategory,deleteCategory};
}
export function useCustomerState(load:DomainLoader){
  const [customers,setCustomers]=useState<Customer[]>(()=>load('customers',[]));
  const saveCustomer=(customer:Customer)=>setCustomers(previous=>previous.some(row=>row.id===customer.id)?previous.map(row=>row.id===customer.id?customer:row):[customer,...previous]);
  return {customers,setCustomers,saveCustomer};
}
