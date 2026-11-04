import { parseModuleRoute, modulePath } from '../../platform/modules/routing';
import { moduleRouteCatalog } from '../../platform/modules/routeCatalog';
import { useSyncExternalStore } from 'react';
import { legacyHashPath, pathForModule, type WorkspaceModule } from './routes';
const event='newhope-navigation';
const snapshot=()=>window.location.pathname+window.location.search;
function subscribe(listener:()=>void){
  window.addEventListener('popstate',listener);window.addEventListener(event,listener);
  const legacy=()=>{const path=legacyHashPath(window.location.hash);if(path)navigate(path,true);};
  window.addEventListener('hashchange',legacy);
  return()=>{window.removeEventListener('popstate',listener);window.removeEventListener(event,listener);window.removeEventListener('hashchange',legacy);};
}
export function navigate(path:string,replace=false){
  const target=new URL(path,window.location.href);
  if(target.protocol!==window.location.protocol||target.host!==window.location.host)throw new Error('EXTERNAL_NAVIGATION_DENIED');
  if(target.pathname+target.search+target.hash===snapshot()+window.location.hash)return;
  window.history[replace?'replaceState':'pushState']({},'',target.pathname+target.search+target.hash);
  window.dispatchEvent(new Event(event));
}
export function navigateModule(module:WorkspaceModule|'home'){
  const current=parseModuleRoute(window.location.pathname);
  const page=current&&Object.entries(moduleRouteCatalog[current.moduleId]).find(([,tab])=>tab===(module==='home'?'overview':module))?.[0];
  navigate(current&&page?modulePath(current.businessId,current.outletId,current.moduleId,page):pathForModule(module));
}
export function useWorkspaceRoute(){return useSyncExternalStore(subscribe,snapshot,()=>'/');}
export function normalizeLegacyRoute(){const path=legacyHashPath(window.location.hash);if(path)navigate(path,true);}
