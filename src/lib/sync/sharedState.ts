import { operationalScopeIssue } from './operationalScope';
import { backupOperational,operationalRecovery } from './operationalRecovery';
export type SharedRecord={scope:string;kind:string;recordId:string;value:Record<string,unknown>|null;revision:number;deleted:boolean;recoveryValue?:Record<string,unknown>;quarantineReason?:string};
type Operation={kind:string;recordId:string;baseRevision:number;value:Record<string,unknown>|null;deleted:boolean;owner?:string;sector?:string};
export type OperationalConflict={kind:string;recordId:string;error?:string;localLabel?:string;serverLabel?:string;localRevision?:number;serverRevision?:number;serverChecked?:boolean};
export type SharedSyncStatus={ready:boolean;pending:number;error:string|null;conflict?:OperationalConflict;conflicts?:OperationalConflict[];quarantined?:number;inFlight?:boolean;lastSyncedAt?:string|null};
const keyFor=(kind:string,id:string)=>`${kind}\x00${id}`;
const outboxKey=(owner:string,sector:string)=>`newhope_shared_outbox_${owner}_${sector}`;
const financialKinds=new Set(['orders','cash_movements','shift','shift_history']);
const globals=new Set(['users','staff_members']);
const recordJson=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export const recordIdOf=(kind:string,row:object):string=>{const v=row as {id?:unknown;code?:unknown;staffId?:unknown};return String(kind==='promo_codes'?v.code:kind==='commission_rules'?v.staffId:v.id);};

/** One durable, replaceable operation per owner/sector/kind/id; cloud values are baselines. */
export class SharedStateSync {
  businessName:string|undefined;
  private remote=new Map<string,SharedRecord>();private pending=new Map<string,Operation>();
  private conflicts=new Map<string,{kind:string;recordId:string;error?:string}>();
  private previous=new Map<string,Map<string,string>>();private ready=false;private error:string|null=null;
  private stopped=false;private inFlight=false;private outletBlocked=false;private timer:ReturnType<typeof setTimeout>|undefined;
  private poll:ReturnType<typeof setInterval>|undefined;private lastSyncedAt:string|null=null;private outletId:string|undefined;
  private readGeneration=0;
  constructor(readonly owner:string,readonly sector:string,readonly onRecords:(rows:SharedRecord[],initial:boolean)=>void,readonly onStatus:(value:SharedSyncStatus)=>void){
    try{
      const raw=localStorage.getItem(outboxKey(owner,sector)),saved=raw?JSON.parse(raw):[];
      const rows=Array.isArray(saved)?saved:saved?.version===2?saved.operations:null;
      if(!Array.isArray(rows))throw Error('OPERATIONAL_QUEUE_INVALID');
      const retired=rows.filter(op=>financialKinds.has(op?.kind));
      if(retired.length){const k='newhope_retired_financial_outbox_'+owner+'_'+sector,old=JSON.parse(localStorage.getItem(k)||'[]');
        localStorage.setItem(k,JSON.stringify([...old,...retired.filter(op=>!old.some((r:unknown)=>recordJson(r)===recordJson(op)))]));}
      const discarded:Array<{kind:string;recordId:string;reason:string;name?:string}>=[];
      for(const op of rows.filter(op=>!financialKinds.has(op?.kind))){
        if(!op?.kind||!op?.recordId)throw Error('OPERATIONAL_QUEUE_INVALID');
        const reason=(!Array.isArray(saved)&&(saved.owner!==owner||saved.sector!==sector))?'WRONG_OUTBOX_SCOPE':this.scopeIssue(op);
        if(reason){discarded.push({kind:op.kind,recordId:op.recordId,reason,name:op.value?.name});continue;}
        const key=keyFor(op.kind,op.recordId);
        if(this.pending.has(key))discarded.push({kind:op.kind,recordId:op.recordId,reason:'DUPLICATE_SUPERSEDED'});
        this.pending.set(key,{...op,owner,sector});
      }
      if(discarded.length)backupOperational(owner,sector,outboxKey(owner,sector),raw!,discarded);
      if(!Array.isArray(saved)){this.lastSyncedAt=saved.lastSyncedAt||null;
        for(const c of saved.conflicts||[])if(this.pending.has(keyFor(c.kind,c.recordId)))this.conflicts.set(keyFor(c.kind,c.recordId),c);}
      if(raw)this.persist();
    }catch(error){this.pending.clear();this.error='OPERATIONAL_QUEUE_REPAIR_FAILED: '+(error instanceof Error?error.message:'unavailable');}
    this.emit();
  }
  private scopeIssue(op:Operation){return op.owner&&op.owner!==this.owner?'WRONG_OWNER':op.sector&&op.sector!==this.sector
    ?`WRONG_SECTOR:${op.sector}`:operationalScopeIssue(this.owner,this.sector,op.kind,op.recordId,op.value);}
  private conflictDetails():OperationalConflict[]{return [...this.conflicts.values()].map(c=>{
    const k=keyFor(c.kind,c.recordId),local=this.pending.get(k),server=this.remote.get(k);
    const label=(v:Record<string,unknown>|null|undefined)=>{const text=v?.name??v?.storeName??v?.title;return typeof text==='string'?text:undefined;};
    return {...c,localLabel:label(local?.value),serverLabel:label(server?.value),localRevision:local?.baseRevision,serverRevision:server?.revision,serverChecked:this.ready};});}
  private emit(){if(this.stopped)return;const conflicts=this.conflictDetails();let quarantined=0;
    try{quarantined=operationalRecovery(this.owner,this.sector).flatMap(row=>row.records.filter(r=>r.reason!=='DUPLICATE_SUPERSEDED'&&r.reason!=='OWNER_CHOSE_SERVER')).length;}catch{this.error='OPERATIONAL_RECOVERY_INVALID';}
    this.onStatus({ready:this.ready,pending:this.pending.size,error:this.error,conflicts,conflict:conflicts[0],quarantined,inFlight:this.inFlight,lastSyncedAt:this.lastSyncedAt});}
  private persist(){localStorage.setItem(outboxKey(this.owner,this.sector),JSON.stringify({version:2,owner:this.owner,sector:this.sector,operations:[...this.pending.values()],conflicts:[...this.conflicts.values()],lastSyncedAt:this.lastSyncedAt}));this.emit();}
  stop(){this.stopped=true;clearTimeout(this.timer);clearInterval(this.poll);}
  private retryScopeBlocks(){for(const [key,c]of this.conflicts)if(c.error&&/^(OUTLET_SETUP_REQUIRED|FREE_)/.test(c.error))this.conflicts.delete(key);}
  setOutletId(value:string|undefined){if(this.outletId!==value){this.outletId=value;this.outletBlocked=false;this.retryScopeBlocks();}}
  async resumeAfterOutletUpdate(){this.outletBlocked=false;this.retryScopeBlocks();await this.refresh(false);await this.flush();}
  start(){void this.refresh(true);this.poll=setInterval(()=>void this.refresh(false),6000);}
  private visible():SharedRecord[]{const rows=new Map(this.remote);for(const [key,op] of this.pending)rows.set(key,{scope:globals.has(op.kind)?'GLOBAL':this.sector,...op,revision:op.baseRevision});return [...rows.values()];}
  async refresh(_initial:boolean){
    if(this.stopped||this.error?.startsWith('OPERATIONAL_QUEUE'))return;
    const generation=++this.readGeneration;
    try{
      const response=await fetch(`/api/v1/sync/state?sector=${encodeURIComponent(this.sector)}`,{cache:'no-store'});
      if(!response.ok)throw Error(`HTTP_${response.status}`);const data=await response.json();if(this.stopped||generation!==this.readGeneration)return;
      if(!data.ok||!Array.isArray(data.records)||data.truncated)throw Error('STATE_INVALID_RESPONSE');
      if(!data.ready){this.error='Unit usaha belum disiapkan untuk sinkronisasi';this.emit();return;}
      if(data.business?.sector===this.sector&&typeof data.business?.name==='string')this.businessName=data.business.name;
      const safe:SharedRecord[]=[];
      for(const row of data.records as SharedRecord[]){
        if(row.recoveryValue)backupOperational(this.owner,this.sector,'cloud-quarantine',recordJson(row),[{kind:row.kind,recordId:row.recordId,reason:row.quarantineReason||'CLOUD_RECOVERY'}]);
        const issue=row.scope!==(globals.has(row.kind)?'GLOBAL':this.sector)?'WRONG_RESPONSE_SCOPE':operationalScopeIssue(this.owner,this.sector,row.kind,row.recordId,row.value);
        if(issue){backupOperational(this.owner,this.sector,'cloud-response',recordJson(row),[{kind:row.kind,recordId:row.recordId,reason:issue}]);continue;}safe.push(row);
      }
      // Complete cloud snapshot: don't keep vanished rows as zombie records.
      this.remote=new Map(safe.map(row=>[keyFor(row.kind,row.recordId),row]));
      for(const [key,op] of this.pending){const row=this.remote.get(key);if(row&&row.revision>op.baseRevision&&row.deleted===op.deleted&&recordJson(row.value)===recordJson(op.value)){this.pending.delete(key);this.conflicts.delete(key);}}
      const first=!this.ready;this.ready=true;this.error=null;this.lastSyncedAt=new Date().toISOString();this.persist();
      this.onRecords(this.visible(),first);if(this.pending.size&&!this.outletBlocked)await this.flush();
    }catch(error){if(!this.stopped&&generation===this.readGeneration){this.error=error instanceof Error?error.message:'STATE_UNAVAILABLE';this.emit();}}
  }
  prime<T extends object>(kind:string,rows:T[]){this.previous.set(kind,new Map(rows.map(row=>[recordIdOf(kind,row),recordJson(row)])));}
  importLegacy<T extends object>(kind:string,rows:T[]){if(this.stopped||this.error?.startsWith('OPERATIONAL_QUEUE'))return;for(const row of rows){const id=recordIdOf(kind,row),key=keyFor(kind,id);if(!this.remote.has(key)&&!this.pending.has(key))this.queue(kind,id,row as Record<string,unknown>,false,0);}this.persist();if(this.pending.size)this.schedule();}
  private queue(kind:string,id:string,value:Record<string,unknown>|null,deleted:boolean,base?:number){
    const key=keyFor(kind,id),op:Operation={kind,recordId:id,value,deleted,owner:this.owner,sector:this.sector,baseRevision:base??this.pending.get(key)?.baseRevision??this.remote.get(key)?.revision??0};
    const reason=this.scopeIssue(op);if(reason){backupOperational(this.owner,this.sector,'rejected-edit',recordJson(op),[{kind,recordId:id,reason,name:typeof value?.name==='string'?value.name:undefined}]);return;}this.pending.set(key,op);
  }
  track<T extends object>(kind:string,rows:T[],prune=true){
    if(this.stopped||this.error?.startsWith('OPERATIONAL_QUEUE'))return;
    try{const next=new Map(rows.filter(row=>recordIdOf(kind,row)!=='undefined').map(row=>[recordIdOf(kind,row),recordJson(row)])),before=this.previous.get(kind);
      this.previous.set(kind,next);if(!before||!this.ready)return;
      for(const [id,json] of next)if(before.get(id)!==json)this.queue(kind,id,JSON.parse(json),false);
      for(const id of before.keys())if(prune&&!next.has(id))this.queue(kind,id,null,true);
      if(this.pending.size){this.persist();this.schedule();}
    }catch{this.error='Penyimpanan operasional gagal; jangan hapus data browser.';this.emit();}
  }
  private schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush(),300);}
  async resolveConflict(choice:'server'|'local',record?:{kind:string;recordId:string}){
    const c=record||this.conflictDetails()[0];if(!c)return;const key=keyFor(c.kind,c.recordId);await this.refresh(false);if(this.stopped||this.error)return;
    // Refresh can replace the pending object; resolve its current version, not an old reference.
    const op=this.pending.get(key);if(!op||!this.conflicts.has(key))return;
    try{if(choice==='server'){backupOperational(this.owner,this.sector,'conflict-resolution',recordJson(op),[{kind:op.kind,recordId:op.recordId,reason:'OWNER_CHOSE_SERVER'}]);this.pending.delete(key);}
      else{if(this.scopeIssue(op))throw Error('WRONG_SECTOR_CANNOT_OVERRIDE');this.pending.set(key,{...op,baseRevision:this.remote.get(key)?.revision||0});}
      this.conflicts.delete(key);this.persist();this.onRecords(this.visible(),false);await this.flush();
    }catch(error){this.error=error instanceof Error?error.message:'RESOLUTION_FAILED';this.emit();}
  }
  async flush(){
    if(this.inFlight||this.stopped||this.outletBlocked||!navigator.onLine||this.error?.startsWith('OPERATIONAL_QUEUE'))return;
    const operations=[...this.pending].filter(([key])=>!this.conflicts.has(key)).map(([,op])=>op).slice(0,100);if(!operations.length)return;
    this.inFlight=true;this.emit();
    try{const response=await fetch('/api/v1/sync/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sector:this.sector,outletId:this.outletId,operations})}),data=await response.json();
      if(this.stopped)return;
      if(!response.ok||!data.ok){if(data.error==='STATE_CONFLICT'){this.conflicts.set(keyFor(data.kind,data.recordId),{kind:data.kind,recordId:data.recordId});this.persist();await this.refresh(false);return;}
        if(data.error==='OUTLET_SETUP_REQUIRED')this.outletBlocked=true;throw Error(data.error||`HTTP_${response.status}`);}
      for(const version of data.versions||[]){const key=keyFor(version.kind,version.recordId),sent=operations.find(op=>keyFor(op.kind,op.recordId)===key);if(!sent)continue;
        this.remote.set(key,{scope:globals.has(sent.kind)?'GLOBAL':this.sector,kind:sent.kind,recordId:sent.recordId,value:sent.value,deleted:sent.deleted,revision:version.revision});
        if(this.pending.get(key)===sent)this.pending.delete(key);else{const newer=this.pending.get(key);if(newer)newer.baseRevision=version.revision;}this.conflicts.delete(key);}
      for(const c of data.conflicts||[])this.conflicts.set(keyFor(c.kind,c.recordId),c);
      for(const r of data.rejected||[]){const key=keyFor(r.kind,r.recordId),op=this.pending.get(key);if(!op)continue;
        if(r.error==='WRONG_SCOPE'){backupOperational(this.owner,this.sector,'server-rejected',recordJson(op),[{kind:op.kind,recordId:op.recordId,reason:r.detail||'WRONG_SCOPE'}]);if(this.pending.get(key)===op)this.pending.delete(key);}
        else this.conflicts.set(key,{kind:op.kind,recordId:op.recordId,error:r.error});}
      this.error=null;this.lastSyncedAt=new Date().toISOString();this.persist();
    }catch(error){this.error=error instanceof Error?error.message:'STATE_UNAVAILABLE';}finally{this.inFlight=false;this.emit();}
    if(!this.stopped&&this.conflicts.size)await this.refresh(false);
    if(!this.stopped&&!this.error&&[...this.pending.keys()].some(key=>!this.conflicts.has(key)))this.schedule();
  }
}
