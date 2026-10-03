/** A live auth event supersedes initial storage restoration. */
export function restoreAuthSession<T>(initial:Promise<T>,subscribe:(receive:(session:T)=>void)=>()=>void,
  apply:(session:T)=>void,onError:(error:unknown)=>void){
  let active=true,eventReceived=false;
  const unsubscribe=subscribe(session=>{
    if(!active)return;
    eventReceived=true;apply(session);
  });
  void initial.then(session=>{if(active&&!eventReceived)apply(session);},error=>{
    if(active&&!eventReceived)onError(error);
  });
  return()=>{active=false;unsubscribe();};
}
