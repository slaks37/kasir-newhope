// Not a production entry. Browser UI uses the real admin routes, but a
// loopback-only server injects a synthetic principal and email provider.
import React,{StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import AdminApp from '../../src/admin/AdminApp';
import {api,setIdentity} from '../../src/admin/api';
import '../../src/index.css';
import '../../src/styles/app-theme.css';
const errors:string[]=[];
window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
(window as any).__consoleErrors=errors;
const request=async(path:string,body?:any)=>{
  const res=await fetch('/api/admin/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',authorization:'Bearer fixture-admin'},body:body?JSON.stringify(body):undefined});
  const result=await res.json();if(!res.ok)throw new Error(result.error);return result;
};
setIdentity('fixture-admin@localhost.invalid');
api.me=()=>request('me');api.overview=()=>Promise.resolve({sectors:[],totals:{},daily:[]});
api.clients=p=>request('clients?'+new URLSearchParams(p as any));
api.client=(id,justification)=>request('clients/'+id+'?justification='+encodeURIComponent(justification));
api.clientAction=(id,body)=>request('clients/'+id+'/actions',body);
api.subscriptions=p=>request('subscriptions?'+new URLSearchParams(p as any));api.payments=()=>request('payments');
api.support=(id,body)=>request('tenants/'+id+'/support',body);
api.supportHistory=(id,why)=>request('tenants/'+id+'/support?justification='+encodeURIComponent(why));
api.subscriptionDetail=(id,why)=>request('tenants/'+id+'/subscription-detail?justification='+encodeURIComponent(why));
createRoot(document.getElementById('root')!).render(<StrictMode><AdminApp/></StrictMode>);
