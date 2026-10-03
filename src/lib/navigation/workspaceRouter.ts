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
  const target=new URL(path,window.location.origin);
  if(target.origin!==window.location.origin)throw new Error('EXTERNAL_NAVIGATION_DENIED');
  if(target.pathname+target.search+target.hash===snapshot()+window.location.hash)return;
  window.history[replace?'replaceState':'pushState']({},'',target.pathname+target.search+target.hash);
  window.dispatchEvent(new Event(event));
}
export function navigateModule(module:WorkspaceModule|'home'){navigate(pathForModule(module));}
export function useWorkspaceRoute(){return useSyncExternalStore(subscribe,snapshot,()=>'/');}
export function normalizeLegacyRoute(){const path=legacyHashPath(window.location.hash);if(path)navigate(path,true);}
