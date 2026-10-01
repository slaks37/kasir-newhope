/** Versioned operational state. One outbox entry per record survives reloads. */
export type SharedRecord = {
  scope: string; kind: string; recordId: string; value: Record<string, unknown> | null;
  revision: number; deleted: boolean;
};
type Operation = { kind:string; recordId:string; baseRevision:number; value:Record<string,unknown>|null; deleted:boolean };
export type SharedSyncStatus = { ready:boolean; pending:number; error:string|null; conflict?:{kind:string;recordId:string} };
const keyFor=(kind:string,id:string)=>`${kind}\x00${id}`;
const outboxKey=(owner:string,sector:string)=>`newhope_shared_outbox_${owner}_${sector}`;
const financialKinds=new Set(['orders','cash_movements','shift','shift_history']);
export const recordIdOf=(kind:string,row:object):string=>{
  const value=row as {id?:unknown;code?:unknown;staffId?:unknown};
  return String(kind==='promo_codes'?value.code:kind==='commission_rules'?value.staffId:value.id);
};

export class SharedStateSync {
  private remote=new Map<string,SharedRecord>();
  private pending=new Map<string,Operation>();
  private previous=new Map<string,Map<string,string>>();
  private ready=false;
  private error:string|null=null;
  private conflict:{kind:string;recordId:string}|undefined;
  private stopped=false;
  private inFlight=false;
  private outletBlocked=false;
  private timer:number|undefined;
  private poll:number|undefined;
  private onStatus:(value:SharedSyncStatus)=>void;
  private outletId:string|undefined;
  constructor(readonly owner:string,readonly sector:string,
    readonly onRecords:(rows:SharedRecord[],initial:boolean)=>void,
    onStatus:(value:SharedSyncStatus)=>void) {
    this.onStatus=onStatus;
    try {
      const raw=localStorage.getItem(outboxKey(owner,sector));
      const saved=raw?JSON.parse(raw):[];
      if(Array.isArray(saved)){
        const retired=saved.filter(op=>financialKinds.has(op?.kind));
        if(retired.length)localStorage.setItem('newhope_retired_financial_outbox_'+owner+'_'+sector,JSON.stringify(retired));
        for(const op of saved.filter(op=>!financialKinds.has(op?.kind))) if(op?.kind && op?.recordId)
        this.pending.set(keyFor(op.kind,op.recordId),op);
      }
    } catch { this.error='Antrean data lokal tidak dapat dibaca'; }
    this.emit();
  }
  private emit(){if(!this.stopped)this.onStatus({ready:this.ready,pending:this.pending.size,error:this.error,conflict:this.conflict});}
  private persist(){
    try {localStorage.setItem(outboxKey(this.owner,this.sector),JSON.stringify([...this.pending.values()]));}
    catch {this.error='Penyimpanan lokal penuh. Perubahan baru berisiko tidak tersimpan.';}
    this.emit();
  }
  stop(){this.stopped=true;window.clearTimeout(this.timer);window.clearInterval(this.poll);}
  setOutletId(value:string|undefined){
    if(this.outletId!==value){this.outletId=value;this.outletBlocked=false;}
  }
  async resumeAfterOutletUpdate(){this.outletBlocked=false;this.error=null;await this.refresh(false);await this.flush();}
  start(){void this.refresh(true);this.poll=window.setInterval(()=>void this.refresh(false),6000);}
  async refresh(_initial:boolean){
    if(this.stopped) return;
    try {
      const response=await fetch(`/api/v1/sync/state?sector=${encodeURIComponent(this.sector)}`,{cache:'no-store'});
      if(!response.ok) throw Error(`HTTP_${response.status}`);
      const data=await response.json();
      if(!data.ok || !Array.isArray(data.records)) throw Error('STATE_INVALID_RESPONSE');
      if(!data.ready){this.error='Unit usaha belum disiapkan untuk sinkronisasi';this.emit();return;}
      const incoming=data.records as SharedRecord[];
      for(const row of incoming){
        const key=keyFor(row.kind,row.recordId),old=this.remote.get(key);
        if(!old || row.revision>=old.revision)this.remote.set(key,row);
      }
      if(this.conflict){
        const key=keyFor(this.conflict.kind,this.conflict.recordId);
        if(!this.pending.has(key))this.conflict=undefined;
      }
      // Retain local pending values: a remote response must never erase offline work.
      const visible=new Map([...this.remote].map(([key,row])=>[key,row]));
      for(const [key,op] of this.pending) visible.set(key,{scope:op.kind==='users'||op.kind==='staff_members'?'GLOBAL':this.sector,
        kind:op.kind,recordId:op.recordId,value:op.value,revision:op.baseRevision,deleted:op.deleted});
      const firstReady=!this.ready;
      this.ready=true;
      if(!this.conflict && !this.outletBlocked)this.error=null;
      this.emit();
      this.onRecords([...visible.values()],firstReady);
      if(this.pending.size && !this.outletBlocked) await this.flush();
    } catch(error){this.error=error instanceof Error?error.message:'STATE_UNAVAILABLE';this.emit();}
  }
  /** Called after remote hydration, before the matching React state effects run. */
  prime<T extends object>(kind:string,rows:T[]){
    this.previous.set(kind,new Map(rows.map(row=>[recordIdOf(kind,row),JSON.stringify(row)])));
  }
  track<T extends object>(kind:string,rows:T[],prune=true){
    if(this.stopped) return;
    const next=new Map(rows.filter(row=>recordIdOf(kind,row)!=='undefined')
      .map(row=>[recordIdOf(kind,row),JSON.stringify(row)]));
    const before=this.previous.get(kind);
    if(!before){this.previous.set(kind,next);return;}
    for(const [id,json] of next){
      if(before.get(id)===json) continue;
      const key=keyFor(kind,id),old=this.pending.get(key),base=old?.baseRevision??this.remote.get(key)?.revision??0;
      this.pending.set(key,{kind,recordId:id,baseRevision:base,value:JSON.parse(json),deleted:false});
    }
    for(const id of before.keys()) if(prune&&!next.has(id)){
      const key=keyFor(kind,id),old=this.pending.get(key),base=old?.baseRevision??this.remote.get(key)?.revision??0;
      this.pending.set(key,{kind,recordId:id,baseRevision:base,value:null,deleted:true});
    }
    this.previous.set(kind,next);
    if(this.pending.size){this.persist();this.schedule();}
  }
  private schedule(){window.clearTimeout(this.timer);this.timer=window.setTimeout(()=>void this.flush(),300);}
  async resolveConflict(choice:'server'|'local'){
    if(!this.conflict)return;
    const {kind,recordId}=this.conflict,key=keyFor(kind,recordId),operation=this.pending.get(key);
    if(!operation)return;
    if(choice==='server'){
      try {
        const backupKey=`newhope_shared_recovery_${this.owner}_${this.sector}`;
        const prior=JSON.parse(localStorage.getItem(backupKey)||'[]');
        const backups=Array.isArray(prior)?prior:[];
        backups.push({savedAt:new Date().toISOString(),operation});
        localStorage.setItem(backupKey,JSON.stringify(backups.slice(-50)));
      } catch {this.error='Cadangan perubahan lokal gagal disimpan';this.emit();return;}
      this.pending.delete(key);this.persist();
    } else {
      // The owner explicitly chose to apply this edit over the latest version.
      await this.refresh(false);
      if(this.error && this.error!=='STATE_CONFLICT' && !this.error.startsWith('Konflik data'))return;
      operation.baseRevision=this.remote.get(key)?.revision||0;
      this.persist();
    }
    this.conflict=undefined;this.error=null;this.emit();
    if(choice==='server')await this.refresh(false);else await this.flush();
  }
  async flush(){
    if(this.inFlight || this.stopped || this.conflict || this.outletBlocked || !navigator.onLine || !this.pending.size) return;
    this.inFlight=true;
    const operations=[...this.pending.values()].slice(0,100);
    try {
      const response=await fetch('/api/v1/sync/state',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sector:this.sector,outletId:this.outletId,operations})});
      const data=await response.json();
      if(!response.ok || !data.ok){
        if(data.error==='STATE_CONFLICT')this.conflict={kind:data.kind,recordId:data.recordId};
        if(data.error==='OUTLET_SETUP_REQUIRED')this.outletBlocked=true;
        this.error=data.error==='STATE_CONFLICT'
          ? `Konflik data ${data.kind}/${data.recordId}. Perubahan lokal disimpan; perlu ditinjau sebelum digabung.`
          : data.error==='OUTLET_SETUP_REQUIRED'
          ? 'Outlet belum aktif. Perubahan tetap tersimpan dan akan dikirim setelah outlet dibuka.'
          : data.error||`HTTP_${response.status}`;
        this.emit();return;
      }
      for(const version of data.versions as Array<{kind:string;recordId:string;revision:number}>){
        const key=keyFor(version.kind,version.recordId),sent=operations.find(op=>keyFor(op.kind,op.recordId)===key);
        if(!sent) continue;
        this.remote.set(key,{scope:version.kind==='users'||version.kind==='staff_members'?'GLOBAL':this.sector,
          kind:version.kind,recordId:version.recordId,value:sent.value,deleted:sent.deleted,revision:version.revision});
        // A newer local edit may have arrived while the request was in flight.
        if(this.pending.get(key)===sent) this.pending.delete(key);
        else {const newer=this.pending.get(key);if(newer)newer.baseRevision=version.revision;}
      }
      this.error=null;this.persist();
    } catch(error){this.error=error instanceof Error?error.message:'STATE_UNAVAILABLE';this.emit();}
    finally {this.inFlight=false;if(this.pending.size&&!this.error)this.schedule();}
  }
}
