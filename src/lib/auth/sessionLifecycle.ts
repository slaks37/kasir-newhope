/** A live auth event supersedes initial storage restoration. */
export function restoreAuthSession<T>(initial:Promise<T>,subscribe:(receive:(session:T)=>void)=>()=>void,
  apply:(session:T)=>void,onError:(error:unknown)=>void,timeoutMs=15000){
  let active=true,eventReceived=false;
  const timer=setTimeout(()=>{if(active&&!eventReceived)onError(new Error('AUTH_RESTORE_TIMEOUT'));},timeoutMs);
  const unsubscribe=subscribe(session=>{
    if(!active)return;
    clearTimeout(timer);
    eventReceived=true;apply(session);
  });
  void initial.then(session=>{clearTimeout(timer);if(active&&!eventReceived)apply(session);},error=>{
    clearTimeout(timer);
    if(active&&!eventReceived)onError(error);
  });
  return()=>{active=false;clearTimeout(timer);unsubscribe();};
}
