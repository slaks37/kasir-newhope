/** Domain selectors can subscribe without inheriting every POS mutation. */
export class SelectedStore<T extends object>{
  private value:T;
  private listeners=new Set<()=>void>();
  private actions=new Map<keyof T,unknown>();
  private selections=new Map<string,{keys:(keyof T)[];value:Partial<T>}>();
  constructor(value:T){this.value=value;}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  snapshot=()=>this.value;
  publish(value:T){this.value=value;for(const listener of this.listeners)listener();}
  select<K extends keyof T>(keys:readonly K[]):Pick<T,K>{
    const id=keys.join('\x00'),previous=this.selections.get(id);
    const next={} as Pick<T,K>;
    for(const key of keys){
      const raw=this.value[key];
      if(typeof raw==='function'){
        if(!this.actions.has(key))this.actions.set(key,(...args:unknown[])=>(this.value[key] as (...a:unknown[])=>unknown)(...args));
        next[key]=this.actions.get(key) as T[K];
      }else next[key]=raw;
    }
    if(previous&&keys.every(key=>Object.is(previous.value[key],next[key])))return previous.value as Pick<T,K>;
    this.selections.set(id,{keys:[...keys],value:next as Partial<T>});return next;
  }
}
