type Job={run:()=>Promise<unknown>;interval:number;hidden?:boolean;events?:string[]};
type Entry={listeners:Set<Job>;next:number;running:boolean;invalidated:boolean};
/** One scheduler/listener set per workspace; resources never overlap. Writes remain durable elsewhere. */
export class RefreshCoordinator {
  private entries=new Map<string,Entry>();
  private timer:ReturnType<typeof setTimeout>|undefined;
  private debounce:ReturnType<typeof setTimeout>|undefined;
  private watching=false;
  private pendingEvents=new Set<string>();
  private trigger=(event:Event)=>{
    if(event.type==='visibilitychange'&&document.hidden)return;
    this.pendingEvents.add(event.type);
    clearTimeout(this.debounce);
    this.debounce=setTimeout(()=>{
      const events=[...this.pendingEvents];this.pendingEvents.clear();
      const global=events.some(type=>['focus','online','visibilitychange'].includes(type));
      for(const entry of this.entries.values()){
        const changed=[...entry.listeners].some(job=>events.some(type=>job.events?.includes(type)));
        if(!global&&!changed)continue;
        // A focus burst need not reread an already-running resource. A domain
        // mutation does: it may have committed after that resource's snapshot.
        if(entry.running){if(changed)entry.invalidated=true;}
        else entry.next=Date.now();
      }
      this.schedule();
    },250);
  };
  register(key:string,job:Job){
    let entry=this.entries.get(key);if(!entry){entry={listeners:new Set(),next:Date.now(),running:false,invalidated:false};this.entries.set(key,entry);}
    entry.listeners.add(job);this.watch();this.schedule();
    return()=>{entry!.listeners.delete(job);if(!entry!.listeners.size)this.entries.delete(key);this.schedule();if(!this.entries.size)this.unwatch();};
  }
  private watch(){if(this.watching||typeof window==='undefined')return;this.watching=true;
    for(const event of ['focus','online','financial-updated','outlets-updated','subscription-updated'])window.addEventListener(event,this.trigger);
    document.addEventListener('visibilitychange',this.trigger);
  }
  private unwatch(){if(!this.watching)return;this.watching=false;clearTimeout(this.timer);clearTimeout(this.debounce);
    this.pendingEvents.clear();
    for(const event of ['focus','online','financial-updated','outlets-updated','subscription-updated'])window.removeEventListener(event,this.trigger);
    document.removeEventListener('visibilitychange',this.trigger);
  }
  private schedule(){clearTimeout(this.timer);if(!this.entries.size)return;
    const due=Math.min(...[...this.entries.values()].filter(e=>!e.running).map(e=>e.next));
    if(Number.isFinite(due))this.timer=setTimeout(()=>void this.tick(),Math.max(0,due-Date.now()));
  }
  private async tick(){
    const now=Date.now();
    for(const [key,entry] of this.entries){if(entry.running||entry.next>now)continue;
      const jobs=[...entry.listeners],interval=Math.min(...jobs.map(j=>j.interval));
      if(!navigator.onLine||(document.hidden&&!jobs.some(j=>j.hidden))){entry.next=now+interval;continue;}
      entry.running=true;
      // Multiple subscribers get the same turn; HTTP reads are coalesced below.
      void Promise.allSettled(jobs.map(job=>Promise.resolve().then(job.run))).finally(()=>{
        entry.running=false;
        entry.next=Date.now()+(entry.invalidated?250:document.hidden?Math.max(interval,120000):interval);
        entry.invalidated=false;
        if(this.entries.get(key)===entry)this.schedule();
      });
    }
    this.schedule();
  }
}
export const refreshCoordinator=new RefreshCoordinator();

const reads=new Map<string,Promise<unknown>>();
let readScope='anonymous',readGeneration=0;
/** A new login cannot join a previous account's in-flight response. */
export function setReadScope(owner:string){if(owner!==readScope){readScope=owner;readGeneration++;reads.clear();}}
/** Sharing is in-flight only: no stale auth-scoped response is persisted or reused after logout. */
export function coalescedRead<T>(key:string,run:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  key=readGeneration+':'+key;
  let pending=reads.get(key) as Promise<T>|undefined;
  if(!pending){pending=run();reads.set(key,pending);void pending.finally(()=>{if(reads.get(key)===pending)reads.delete(key);}).catch(()=>{});}
  if(!signal)return pending;
  return new Promise<T>((resolve,reject)=>{
    const abort=()=>reject(new DOMException('Request aborted','AbortError'));
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    pending!.then(value=>{if(!signal.aborted)resolve(value);},reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
