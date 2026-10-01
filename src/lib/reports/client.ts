import { useEffect, useState } from 'react';
import type { ServerReportSummary, ServerTransactionsResponse, ServerTransaction } from './types';

export interface ReportQuery {outletId?:string;sector:string;from?:string;to?:string;timezone?:string;paymentMethod?:string;search?:string}
export function reportParams(query:ReportQuery):URLSearchParams{
  return new URLSearchParams(Object.entries(query).filter(([,value])=>value!==undefined&&value!=='') as [string,string][]);
}
async function request<T>(path:string,params:URLSearchParams,signal?:AbortSignal):Promise<T>{
  const response=await fetch(`/api/v1/reports/${path}?${params}`,{signal,cache:'no-store'});
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.error||'REPORT_UNAVAILABLE');return data as T;
}
export const fetchReportSummary=(query:ReportQuery,signal?:AbortSignal)=>request<ServerReportSummary>('summary',reportParams(query),signal);
/** POS receipt cache is bounded; complete historical reports use keyset pages. */
export async function fetchRecentServerTransactions(query:ReportQuery,signal?:AbortSignal):Promise<ServerTransaction[]>{
  const params=reportParams(query);params.set('limit','100');
  return (await request<ServerTransactionsResponse>('transactions',params,signal)).transactions;
}
/** Fetch every keyset page. Never silently present a partial device history as complete. */
export async function fetchServerTransactions(query:ReportQuery,signal?:AbortSignal):Promise<ServerTransaction[]>{
  const params=reportParams(query);params.set('limit','500');const rows:ServerTransaction[]=[];
  const cursors=new Set<string>();let cursor:string|null=null;
  do{if(cursor)params.set('cursor',cursor);
    const page=await request<ServerTransactionsResponse>('transactions',params,signal);rows.push(...page.transactions);
    cursor=page.nextCursor;if(cursor&&cursors.has(cursor))throw new Error('INVALID_REPORT_CURSOR');if(cursor)cursors.add(cursor);
  }while(cursor);return rows;
}
export function calendarDate(zone='Asia/Jakarta',offsetDays=0):string{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=(type:string)=>parts.find(p=>p.type===type)?.value;
  const date=new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+offsetDays);
  return date.toISOString().slice(0,10);
}
export function useServerReport(query:ReportQuery,includeTransactions=true){
  const key=reportParams(query).toString();
  const [state,setState]=useState<{key:string;summary:ServerReportSummary|null;transactions:ServerTransaction[];loading:boolean;error:string|null}>({key,summary:null,transactions:[],loading:true,error:null});
  useEffect(()=>{
    const controller=new AbortController();let running=false;
    setState({key,summary:null,transactions:[],loading:true,error:null});
    const refresh=async()=>{
      if(running||controller.signal.aborted)return;running=true;
      try{
        if(!query.outletId)throw new Error('OUTLET_SETUP_REQUIRED');
        const [summary,transactions]=await Promise.all([fetchReportSummary(query,controller.signal),includeTransactions?fetchServerTransactions(query,controller.signal):Promise.resolve([])]);
        if(!controller.signal.aborted)setState({key,summary,transactions,loading:false,error:null});
      }catch(error){if(!controller.signal.aborted)setState({key,summary:null,transactions:[],loading:false,error:error instanceof Error?error.message:'REPORT_UNAVAILABLE'});}
      finally{running=false;}
    };
    void refresh();const interval=window.setInterval(refresh,15000);
    const updated=()=>void refresh();window.addEventListener('financial-updated',updated);window.addEventListener('focus',updated);window.addEventListener('online',updated);
    return()=>{controller.abort();window.clearInterval(interval);window.removeEventListener('financial-updated',updated);window.removeEventListener('focus',updated);window.removeEventListener('online',updated);};
  },[key,includeTransactions]);
  return state.key===key?state:{key,summary:null,transactions:[],loading:true,error:null};
}
