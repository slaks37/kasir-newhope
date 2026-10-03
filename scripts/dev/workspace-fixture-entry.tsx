/** Browser profiling entry, not a production Vite input. */
import React,{Profiler,StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AuthProvider} from '../../src/context/AuthContext';
import {LanguageProvider} from '../../src/i18n/LanguageContext';
import App from '../../src/App';
import '../../src/index.css';
import '../../src/styles/app-theme.css';
const stats={startedAt:performance.now(),commits:0,renderMs:0,storageWrites:0,longTasks:[] as number[],errors:[] as string[]};
// Test-only fault injection, not imported by the production Vite entry. The
// document remains available so reload tests can verify cached module state.
let fixtureOffline=sessionStorage.getItem('fixture-offline')==='true';
Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>!fixtureOffline});
const fixtureFetch=window.fetch.bind(window);
window.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
  if(fixtureOffline&&url.pathname.startsWith('/api/'))return Promise.reject(new TypeError('FIXTURE_OFFLINE'));
  return fixtureFetch(input,init);
}) as typeof fetch;
const setItem=Storage.prototype.setItem;
Storage.prototype.setItem=function(key,value){stats.storageWrites++;return setItem.call(this,key,value);};
try{new PerformanceObserver(list=>{for(const entry of list.getEntries())stats.longTasks.push(entry.duration);}).observe({type:'longtask',buffered:true});}catch{}
window.addEventListener('error',event=>stats.errors.push(event.message));window.addEventListener('unhandledrejection',event=>stats.errors.push(String(event.reason)));
function FixtureToolbar(){const [offline,setOffline]=useState(fixtureOffline);return <div style={{position:'fixed',bottom:0,right:0,zIndex:500,background:'#fff',padding:8,border:'1px solid #aaa'}}><button onClick={()=>{void fetch('/__fixture/browser-metrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...stats,elapsedMs:performance.now()-stats.startedAt,resources:performance.getEntriesByType('resource').filter((r:any)=>r.name.includes('/api/')).map((r:any)=>({path:new URL(r.name).pathname,ms:r.duration,bytes:r.transferSize}))})});}}>Fixture metrics</button><button onClick={()=>{stats.commits=0;stats.renderMs=0;stats.storageWrites=0;stats.longTasks=[];stats.errors=[];stats.startedAt=performance.now();performance.clearResourceTimings();void fetch('/__fixture/reset',{method:'POST'});}}>Reset measurement</button><button onClick={()=>{fixtureOffline=!fixtureOffline;sessionStorage.setItem('fixture-offline',String(fixtureOffline));setOffline(fixtureOffline);window.dispatchEvent(new Event(fixtureOffline?'offline':'online'));}}>{offline?'Restore fixture network':'Simulate fixture offline'}</button></div>;}
createRoot(document.getElementById('root')!).render(<Profiler id="workspace" onRender={(_id,_phase,duration)=>{stats.commits++;stats.renderMs+=duration;}}><StrictMode><LanguageProvider><AuthProvider><App/></AuthProvider></LanguageProvider><FixtureToolbar/></StrictMode></Profiler>);
