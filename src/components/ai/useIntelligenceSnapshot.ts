import {useEffect,useMemo,useState} from 'react';
import {usePOS} from '../../context/POSContext';
import {useTenant} from '../../context/TenantContext';
import {buildSnapshot} from '../../lib/assistant/snapshot';
export function useIntelligenceSnapshot(){
  const p=usePOS();const t=useTenant();const [minute,setMinute]=useState(()=>Math.floor(Date.now()/60_000));
  useEffect(()=>{const timer=setInterval(()=>setMinute(Math.floor(Date.now()/60_000)),60_000);return()=>clearInterval(timer);},[]);
  return useMemo(()=>buildSnapshot({businessId:t.businessId,merchantId:t.merchantId,tenantId:t.tenantId,userRole:t.userRole,
    settings:p.settings,categories:p.categories,products:p.products,stockItems:p.stockItems,inventoryLogs:p.inventoryLogs,orders:p.orders,customers:p.customers,tables:p.tables,staff:p.staffMembers,attendance:p.attendanceLogs,shifts:p.shiftHistory,currentShift:p.shift,promoCodes:p.promoCodes}),
    [t.businessId,t.merchantId,t.tenantId,t.userRole,p.settings,p.categories,p.products,p.stockItems,p.inventoryLogs,p.orders,p.customers,p.tables,p.staffMembers,p.attendanceLogs,p.shiftHistory,p.shift,p.promoCodes,minute]);
}
