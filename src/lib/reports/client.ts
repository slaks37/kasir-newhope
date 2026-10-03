import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerReportSummary, ServerTransactionsResponse, ServerTransaction } from './types';
import { coalescedRead, refreshCoordinator } from '../sync/refreshCoordinator';
import type {Shift} from '../../types';

export interface ReportQuery {outletId?:string;sector:string;from?:string;to?:string;timezone?:string;paymentMethod?:string;search?:string}
export function reportParams(query:ReportQuery):URLSearchParams{
  return new URLSearchParams(Object.entries(query).filter(([,value])=>value!==undefined&&value!=='').sort(([a],[b])=>a.localeCompare(b)) as [string,string][]);
}
async function request<T>(path:string,params:URLSearchParams,signal?:AbortSignal):Promise<T>{
  const url=`/api/v1/reports/${path}?${params}`;
  return coalescedRead(url,async()=>{
    const response=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-store'});
    const data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||'REPORT_UNAVAILABLE');return data as T;
  },signal);
}
export const fetchReportSummary=(query:ReportQuery,signal?:AbortSignal)=>request<ServerReportSummary>('summary',reportParams(query),signal);
export async function fetchTransactionPage(query:ReportQuery,cursor?:string|null,signal?:AbortSignal,limit=100):Promise<ServerTransactionsResponse>{
  const params=reportParams(query);params.set('limit',String(limit));if(cursor)params.set('cursor',cursor);
  return request<ServerTransactionsResponse>('transactions',params,signal);
}
export async function fetchRecentServerTransactions(query:ReportQuery,signal?:AbortSignal):Promise<ServerTransaction[]>{
  return (await fetchTransactionPage(query,null,signal)).transactions;
}
/** Minimal cash-register bootstrap. Reports own their period summary; opening
 * POS must not aggregate all-time sales/cash or walk transaction history. */
export async function fetchFinancialWorkspace(query:ReportQuery,includeRecent:boolean,signal?:AbortSignal){
  const url='/api/v1/finance/shift?'+reportParams(query);
  const shiftRead=coalescedRead(url,async()=>{
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(response.status===401||response.status===403)throw Error('WORKSPACE_ACCESS_REVOKED');
    const result=await response.json();
    if(!response.ok||!result.ok)throw Error(result.error||'SHIFT_UNAVAILABLE');
    return result as {ok:true;shift:Shift|null;history:Shift[];generatedAt?:string};
  },signal);
  const [shiftData,transactions]=await Promise.all([shiftRead,includeRecent?fetchRecentServerTransactions(query,signal):Promise.resolve(null)]);
  return {shiftData,transactions};
}
/** Explicit export/history traversal ONLY. Never call from an automatic refresh. */
export async function fetchServerTransactions(query:ReportQuery,signal?:AbortSignal):Promise<ServerTransaction[]>{
  const rows:ServerTransaction[]=[],cursors=new Set<string>();let cursor:string|null=null;
  do{
    const page=await fetchTransactionPage(query,cursor,signal,500);rows.push(...page.transactions);
    cursor=page.nextCursor;if(cursor&&cursors.has(cursor))throw new Error('INVALID_REPORT_CURSOR');if(cursor)cursors.add(cursor);
  }while(cursor);return rows;
}
export function calendarDate(zone='Asia/Jakarta',offsetDays=0):string{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=(type:string)=>parts.find(p=>p.type===type)?.value;
  const date=new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+offsetDays);
  return date.toISOString().slice(0,10);
}
type ReportState={key:string;summary:ServerReportSummary|null;transactions:ServerTransaction[];nextCursor:string|null;loading:boolean;loadingMore:boolean;error:string|null};
const empty=(key:string):ReportState=>({key,summary:null,transactions:[],nextCursor:null,loading:true,loadingMore:false,error:null});
export function useServerReport(query:ReportQuery,includeTransactions=true){
  const key=reportParams(query).toString()+':'+includeTransactions;
  const cache=useRef(new Map<string,ReportState>());
  const [state,setState]=useState<ReportState>(()=>empty(key));
  const current=useRef({key,query});current.current={key,query};
  const loadingPage=useRef<string|null>(null);
  const revision=useRef(0);
  useEffect(()=>{
    const controller=new AbortController();
    setState(cache.current.get(key)||empty(key));
    const refresh=async()=>{
      const generation=++revision.current;
      try{
        if(!query.outletId)throw new Error('OUTLET_SETUP_REQUIRED');
        const summary=await fetchReportSummary(query,controller.signal);
        if(controller.signal.aborted||generation!==revision.current)return;
        // Summary is authoritative and usable before details have arrived.
        setState(previous=>({...previous,key,summary,loading:false,error:null}));
        const page=includeTransactions?await fetchTransactionPage(query,null,controller.signal):null;
        if(controller.signal.aborted||generation!==revision.current)return;
        const next={key,summary,transactions:page?.transactions||[],nextCursor:page?.nextCursor||null,loading:false,loadingMore:false,error:null};
        cache.current.set(key,next);if(cache.current.size>10)cache.current.delete(cache.current.keys().next().value!);
        setState(next);
      }catch(error){if(!controller.signal.aborted&&generation===revision.current)setState(previous=>({...previous,key,loading:false,error:error instanceof Error?error.message:'REPORT_UNAVAILABLE'}));}
    };
    const unsubscribe=refreshCoordinator.register('report:'+key,{run:refresh,interval:60000,events:['financial-updated']});
    return()=>{controller.abort();revision.current++;unsubscribe();};
  },[key,includeTransactions]);
  const loadMore=useCallback(async()=>{
    if(current.current.key!==state.key||!state.nextCursor||loadingPage.current===key)return;
    loadingPage.current=key;setState(previous=>({...previous,loadingMore:true}));
    const generation=revision.current;
    try{
      const cursor=state.nextCursor,page=await fetchTransactionPage(query,cursor);
      if(current.current.key!==key||generation!==revision.current)return;
      if(page.nextCursor===cursor)throw new Error('INVALID_REPORT_CURSOR');
      setState(previous=>{
        if(previous.key!==key||previous.nextCursor!==cursor)return previous;
        const rows=new Map(previous.transactions.map(row=>[row.serverId,row]));
        for(const row of page.transactions)rows.set(row.serverId,row);
        const next={...previous,transactions:[...rows.values()],nextCursor:page.nextCursor,loadingMore:false,error:null};
        cache.current.set(key,next);return next;
      });
    }catch(error){if(current.current.key===key&&generation===revision.current)setState(previous=>({...previous,loadingMore:false,error:error instanceof Error?error.message:'REPORT_UNAVAILABLE'}));}
    finally{if(loadingPage.current===key){loadingPage.current=null;if(current.current.key===key)setState(previous=>({...previous,loadingMore:false}));}}
  },[key,state.key,state.nextCursor,query]);
  return {...(state.key===key?state:empty(key)),loadMore};
}
