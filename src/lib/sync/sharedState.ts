import { operationalScopeIssue,operationalKinds } from './operationalScope';
import { backupOperational,operationalRecovery } from './operationalRecovery';
export type SharedRecord={scope:string;kind:string;recordId:string;value:Record<string,unknown>|null;revision:number;deleted:boolean;recoveryValue?:Record<string,unknown>;quarantineReason?:string};
type Operation={kind:string;recordId:string;baseRevision:number;value:Record<string,unknown>|null;deleted:boolean;owner?:string;sector?:string;origin?:'edit'|'legacy'};
export type OperationalConflict={kind:string;recordId:string;error?:string;localLabel?:string;serverLabel?:string;localRevision?:number;serverRevision?:number;serverChecked?:boolean};
export type SharedSyncStatus={ready:boolean;pending:number;error:string|null;conflict?:OperationalConflict;conflicts?:OperationalConflict[];quarantined?:number;inFlight?:boolean;lastSyncedAt?:string|null};
const keyFor=(kind:string,id:string)=>`${kind}\x00${id}`;
const outboxKey=(owner:string,sector:string,namespace?:string)=>namespace?`newhope_shared_outbox_v3_${owner}_${namespace}`:`newhope_shared_outbox_${owner}_${sector}`;
type Identity={businessId:string;transportRef:string;namespace?:string};
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
  private poll:ReturnType<typeof setTimeout>|undefined;private lastSyncedAt:string|null=null;private outletId:string|undefined;
  private readGeneration=0;
  private quarantinedKeys=new Set<string>();
  private legacyCheckedKeys=new Set<string>();
  legacyQuarantined(kind:string,id:string){return this.quarantinedKeys.has(keyFor(kind,id));}
  private kinds:string[]|undefined;private loadedKinds=new Set<string>();
  hasLoadedKinds(kinds:string[]){return this.ready&&kinds.every(kind=>this.loadedKinds.has(kind));}
  private trackedRows=new Map<string,object[]>();
  private versions=new Map<string,string>();
  private offlineExpiry:number|undefined;
  private baselineKey(kind:string){return `newhope_operational_baseline_v1_${this.owner}_${this.identity?.namespace||this.sector}_${kind}`;}
  /** Baselines are cached version/value pairs, not pending operations or ACKs.
   * Per-kind keys keep an unopened payroll/catalog out of bootstrap parsing. */
  private saveBaselines(kinds:string[]){
    for(const kind of kinds){
      const key=this.baselineKey(kind),records=[...this.remote.values()].filter(row=>row.kind===kind);
      const raw=JSON.stringify({version:1,owner:this.owner,sector:this.sector,businessId:this.identity?.businessId,records});
      if(localStorage.getItem(key)!==raw)localStorage.setItem(key,raw);
    }
  }
  restoreOffline(expiresAt:number){
    this.offlineExpiry=expiresAt;
    if(this.stopped||navigator.onLine||this.error?.startsWith('OPERATIONAL_QUEUE'))return false;
    try{
      if(Date.now()>=expiresAt)throw Error('OFFLINE_VERIFICATION_EXPIRED');
      const requested=this.kinds||[];
      const missing=requested.filter(kind=>!this.loadedKinds.has(kind));
      const restored:SharedRecord[]=[];
      for(const kind of missing){
        const key=this.baselineKey(kind),raw=localStorage.getItem(key);
        if(!raw)throw Error('OFFLINE_MODULE_NOT_CACHED');
        const saved=JSON.parse(raw);
        if(saved.version!==1||saved.owner!==this.owner||saved.sector!==this.sector||saved.businessId!==this.identity?.businessId||!Array.isArray(saved.records))throw Error('OFFLINE_BASELINE_INVALID');
        const discarded:Parameters<typeof backupOperational>[4]=[];
        const seen=new Set<string>();
        for(const row of saved.records as SharedRecord[]){
          if(!row||row.kind!==kind||!operationalKinds.has(kind)||typeof row.recordId!=='string'||!row.recordId||seen.has(row.recordId)||
            !Number.isSafeInteger(row.revision)||row.revision<1||typeof row.deleted!=='boolean'||
            row.deleted&&row.value!==null||!row.deleted&&(!row.value||typeof row.value!=='object'||Array.isArray(row.value)))throw Error('OFFLINE_BASELINE_INVALID');
          seen.add(row.recordId);
          const issue=row.scope!==(globals.has(kind)?'GLOBAL':this.sector)?'WRONG_RESPONSE_SCOPE':operationalScopeIssue(this.owner,this.sector,kind,row.recordId,row.value,this.identity?.transportRef);
          if(issue)discarded.push({kind,recordId:row.recordId,reason:issue});else restored.push(row);
        }
        if(discarded.length){
          this.backup(key,raw,discarded);
          localStorage.setItem(key,JSON.stringify({...saved,records:restored.filter(row=>row.kind===kind)}));
        }
      }
      for(const row of restored)this.remote.set(keyFor(row.kind,row.recordId),row);
      // Consumer hydration must succeed before edits may use cached revisions.
      this.onRecords(this.visible(),!this.ready,requested);
      for(const kind of missing)this.loadedKinds.add(kind);
      this.ready=true;this.error=null;this.emit();return true;
    }catch(error){this.ready=false;this.error=error instanceof Error?error.message:'OFFLINE_BASELINE_INVALID';this.emit();return false;}
  }
  setKinds(kinds:string[]){const next=[...new Set(kinds)].sort();const changed=JSON.stringify(next)!==JSON.stringify(this.kinds);this.kinds=next;return changed;}
  constructor(readonly owner:string,readonly sector:string,readonly onRecords:(rows:SharedRecord[],initial:boolean,loadedKinds?:string[])=>void,readonly onStatus:(value:SharedSyncStatus)=>void,readonly identity?:Identity){
    const namespace=identity?.namespace;
    try{
      for(const backup of operationalRecovery(owner,sector,namespace))for(const r of backup.records)if(r.reason!=='DUPLICATE_SUPERSEDED')this.quarantinedKeys.add(keyFor(r.kind,r.recordId));
      const raw=localStorage.getItem(outboxKey(owner,sector,namespace)),saved=raw?JSON.parse(raw):[];
      const rows=Array.isArray(saved)?saved:saved?.version===2?saved.operations:null;
      if(!Array.isArray(rows))throw Error('OPERATIONAL_QUEUE_INVALID');
      const retired=rows.filter(op=>financialKinds.has(op?.kind));
      if(retired.length){const k='newhope_retired_financial_outbox_'+owner+'_'+(namespace||sector),old=JSON.parse(localStorage.getItem(k)||'[]');
        localStorage.setItem(k,JSON.stringify([...old,...retired.filter(op=>!old.some((r:unknown)=>recordJson(r)===recordJson(op)))]));}
      const discarded:Array<{kind:string;recordId:string;reason:string;name?:string}>=[];
      for(const op of rows.filter(op=>!financialKinds.has(op?.kind))){
        if(!op?.kind||!op?.recordId)throw Error('OPERATIONAL_QUEUE_INVALID');
        const reason=(!Array.isArray(saved)&&(saved.owner!==owner||saved.sector!==sector||namespace&&saved.businessId!==identity?.businessId))?'WRONG_OUTBOX_SCOPE':this.scopeIssue(op);
        if(reason){discarded.push({kind:op.kind,recordId:op.recordId,reason,name:op.value?.name});continue;}
        const key=keyFor(op.kind,op.recordId);
        if(this.pending.has(key))discarded.push({kind:op.kind,recordId:op.recordId,reason:'DUPLICATE_SUPERSEDED'});
        this.pending.set(key,{...op,owner,sector,origin:op.origin||'legacy'});
      }
      if(discarded.length)this.backup(outboxKey(owner,sector,namespace),raw!,discarded);
      if(!Array.isArray(saved)){this.lastSyncedAt=saved.lastSyncedAt||null;
        for(const c of saved.conflicts||[])if(this.pending.has(keyFor(c.kind,c.recordId)))this.conflicts.set(keyFor(c.kind,c.recordId),c);}
      if(raw)this.persist();
    }catch(error){this.pending.clear();this.error='OPERATIONAL_QUEUE_REPAIR_FAILED: '+(error instanceof Error?error.message:'unavailable');}
    this.emit();
  }
  private backup(source:string,raw:string,records:Parameters<typeof backupOperational>[4]){backupOperational(this.owner,this.sector,source,raw,records,this.identity?.namespace);}
  private scopeIssue(op:Operation){return op.owner&&op.owner!==this.owner?'WRONG_OWNER':op.sector&&op.sector!==this.sector
    ?`WRONG_SECTOR:${op.sector}`:operationalScopeIssue(this.owner,this.sector,op.kind,op.recordId,op.value,this.identity?.transportRef);}
  private conflictDetails():OperationalConflict[]{return [...this.conflicts.values()].map(c=>{
    const k=keyFor(c.kind,c.recordId),local=this.pending.get(k),server=this.remote.get(k);
    const label=(v:Record<string,unknown>|null|undefined)=>{const text=v?.name??v?.storeName??v?.title;return typeof text==='string'?text:undefined;};
    return {...c,localLabel:label(local?.value),serverLabel:label(server?.value),localRevision:local?.baseRevision,serverRevision:server?.revision,serverChecked:this.ready};});}
  private emit(){if(this.stopped)return;const conflicts=this.conflictDetails();let quarantined=0;
    try{quarantined=operationalRecovery(this.owner,this.sector,this.identity?.namespace).flatMap(row=>row.records.filter(r=>r.reason!=='DUPLICATE_SUPERSEDED'&&r.reason!=='OWNER_CHOSE_SERVER')).length;}catch{this.error='OPERATIONAL_RECOVERY_INVALID';}
    const scopeUnchecked=[...this.pending].some(([key,op])=>op.origin==='legacy'&&!globals.has(op.kind)&&!this.legacyCheckedKeys.has(key));
    this.onStatus({ready:this.ready&&!scopeUnchecked,pending:this.pending.size,error:this.error,conflicts,conflict:conflicts[0],quarantined,inFlight:this.inFlight,lastSyncedAt:this.lastSyncedAt});}
  private persist(){const key=outboxKey(this.owner,this.sector,this.identity?.namespace),json=JSON.stringify({version:2,owner:this.owner,sector:this.sector,businessId:this.identity?.businessId,operations:[...this.pending.values()],conflicts:[...this.conflicts.values()],lastSyncedAt:this.lastSyncedAt});if(localStorage.getItem(key)!==json)localStorage.setItem(key,json);this.emit();}
  stop(){this.stopped=true;clearTimeout(this.timer);clearTimeout(this.poll);}
  private retryScopeBlocks(){for(const [key,c]of this.conflicts)if(c.error&&/^(OUTLET_SETUP_REQUIRED|FREE_)/.test(c.error))this.conflicts.delete(key);}
  setOutletId(value:string|undefined){if(this.outletId!==value){this.outletId=value;this.outletBlocked=false;this.retryScopeBlocks();}}
  async resumeAfterOutletUpdate(){this.outletBlocked=false;this.retryScopeBlocks();await this.refresh(false);await this.flush();}
  start(){
    const tick=async(initial=false)=>{try{if(navigator.onLine)await this.refresh(initial);}finally{
      // Schedule after completion: slow networks cannot continually invalidate hydration.
      if(!this.stopped)this.poll=setTimeout(()=>void tick(),6000);
    }};
    void tick(true);
  }
  private visible():SharedRecord[]{const rows=new Map(this.remote);for(const [key,op] of this.pending)rows.set(key,{scope:globals.has(op.kind)?'GLOBAL':this.sector,...op,revision:op.baseRevision});return [...rows.values()];}
  async refresh(_initial:boolean){
    if(this.stopped||this.error?.startsWith('OPERATIONAL_QUEUE'))return;
    if(!navigator.onLine){if(this.offlineExpiry)this.restoreOffline(this.offlineExpiry);return;}
    const generation=++this.readGeneration;
    try{
      const candidates=[...this.pending.values()].filter(op=>op.origin==='legacy'&&!this.legacyCheckedKeys.has(keyFor(op.kind,op.recordId))).slice(0,100).map(op=>({kind:op.kind,recordId:op.recordId}));
      const requestedKinds=this.kinds?[...new Set([...this.kinds,...[...this.pending.values()].map(op=>op.kind)])]:undefined;
      const versionKey=requestedKinds?[...requestedKinds].sort().join(','):'*',knownVersion=this.versions.get(versionKey);
      const response=await fetch(`/api/v1/sync/state?sector=${encodeURIComponent(this.sector)}${this.identity?'&businessId='+encodeURIComponent(this.identity.businessId):''}${requestedKinds?'&kinds='+encodeURIComponent(requestedKinds.join(',')):''}${knownVersion?'&knownVersion='+encodeURIComponent(knownVersion):''}${candidates.length?'&legacyCandidates='+encodeURIComponent(JSON.stringify(candidates)):''}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error(`HTTP_${response.status}`);const data=await response.json();if(this.stopped||generation!==this.readGeneration)return;
      if(!data.ok||!Array.isArray(data.records)||data.truncated)throw Error('STATE_INVALID_RESPONSE');
      if(requestedKinds&&data.records.some((row:SharedRecord)=>!requestedKinds.includes(row.kind)))throw Error('STATE_KIND_SCOPE_INVALID');
      if(!data.ready){this.error='Unit usaha belum disiapkan untuk sinkronisasi';this.emit();return;}
      if(this.identity&&data.business?.businessId!==this.identity.businessId)throw Error('STATE_BUSINESS_SCOPE_INVALID');
      if(data.business?.sector===this.sector&&typeof data.business?.name==='string')this.businessName=data.business.name;
      if(data.unchanged){
        if(!knownVersion||data.version!==knownVersion||!this.ready)throw Error('STATE_VERSION_INVALID');
        this.error=null;this.lastSyncedAt=new Date().toISOString();this.emit();
        if(this.pending.size&&!this.outletBlocked)await this.flush();return;
      }
      const safe:SharedRecord[]=[];
      for(const row of data.records as SharedRecord[]){
        if(row.recoveryValue)this.backup('cloud-quarantine',recordJson(row),[{kind:row.kind,recordId:row.recordId,reason:row.quarantineReason||'CLOUD_RECOVERY'}]);
        const issue=row.scope!==(globals.has(row.kind)?'GLOBAL':this.sector)?'WRONG_RESPONSE_SCOPE':operationalScopeIssue(this.owner,this.sector,row.kind,row.recordId,row.value,this.identity?.transportRef);
        if(issue){this.backup('cloud-response',recordJson(row),[{kind:row.kind,recordId:row.recordId,reason:issue}]);continue;}safe.push(row);
      }
      // Complete cloud snapshot: don't keep vanished rows as zombie records.
      const receivedKinds=requestedKinds&&Array.isArray(data.kinds)?data.kinds as string[]:undefined;
      if(requestedKinds&&(!receivedKinds||requestedKinds.some(kind=>!receivedKinds.includes(kind))))throw Error('STATE_KIND_SCOPE_INVALID');
      const retained=receivedKinds?[...this.remote.values()].filter(row=>!receivedKinds.includes(row.kind)):[];
      this.remote=new Map([...retained,...safe].map(row=>[keyFor(row.kind,row.recordId),row]));
      if(receivedKinds)for(const kind of receivedKinds)this.loadedKinds.add(kind);
      for(const foreign of data.foreignRecords||[]){const key=keyFor(foreign.kind,foreign.recordId),op=this.pending.get(key);
        if(!op||op.origin!=='legacy'||this.remote.has(key)||op.value?.businessId||op.value?.sector||op.value?.businessSector)continue;
        const uniqueId=/^(?:cust-|product-)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(op.recordId);
        if(!uniqueId&&recordJson(op.value)!==recordJson(foreign.value))continue;
        const review=[{kind:op.kind,recordId:op.recordId,reason:'OTHER_CONFIRMED_SECTOR:'+foreign.scope}];
        this.backup('legacy-scope-proof',recordJson(op),review);
        const cache=`newhope_data_${this.identity?.transportRef||this.owner+'_'+this.sector}_${op.kind}`,raw=localStorage.getItem(cache);
        if(raw)this.backup(cache,raw,review);
        this.quarantinedKeys.add(key);this.pending.delete(key);this.conflicts.delete(key);
      }
      if(data.scopeProof)for(const candidate of candidates)this.legacyCheckedKeys.add(keyFor(candidate.kind,candidate.recordId));
      for(const [key,op] of this.pending){const row=this.remote.get(key);if(row&&row.revision>op.baseRevision&&row.deleted===op.deleted&&recordJson(row.value)===recordJson(op.value)){this.pending.delete(key);this.conflicts.delete(key);}}
      const first=!this.ready;
      this.persist();
      this.onRecords(this.visible(),first,receivedKinds);
      this.saveBaselines(receivedKinds||[...new Set(safe.map(row=>row.kind))]);
      // Never send knownVersion after a failed backup, durable write or consumer
      // hydration: an unchanged reply would otherwise skip the failed recovery.
      this.ready=true;this.error=null;this.lastSyncedAt=new Date().toISOString();this.persist();
      if(typeof data.version==='string'&&/^[a-f0-9]{32}$/.test(data.version))this.versions.set(versionKey,data.version);
      if(this.pending.size&&!this.outletBlocked)await this.flush();
    }catch(error){if(!this.stopped&&generation===this.readGeneration){this.error=error instanceof Error?error.message:'STATE_UNAVAILABLE';this.emit();}}
  }
  prime<T extends object>(kind:string,rows:T[]){this.trackedRows.delete(kind);this.previous.set(kind,new Map(rows.map(row=>[recordIdOf(kind,row),recordJson(row)])));}
  importLegacy<T extends object>(kind:string,rows:T[]){if(this.stopped||this.error?.startsWith('OPERATIONAL_QUEUE'))return;for(const row of rows){const id=recordIdOf(kind,row),key=keyFor(kind,id);if(!this.remote.has(key)&&!this.pending.has(key)&&!this.quarantinedKeys.has(key))this.queue(kind,id,row as Record<string,unknown>,false,0,'legacy');}this.persist();if(this.pending.size)this.schedule();}
  private queue(kind:string,id:string,value:Record<string,unknown>|null,deleted:boolean,base?:number,origin:'edit'|'legacy'='edit'){
    const key=keyFor(kind,id),op:Operation={kind,recordId:id,value,deleted,owner:this.owner,sector:this.sector,origin,baseRevision:base??this.pending.get(key)?.baseRevision??this.remote.get(key)?.revision??0};
    const reason=this.scopeIssue(op);if(reason){this.backup('rejected-edit',recordJson(op),[{kind,recordId:id,reason,name:typeof value?.name==='string'?value.name:undefined}]);return;}this.pending.set(key,op);
  }
  track<T extends object>(kind:string,rows:T[],prune=true){
    if(this.stopped||this.error?.startsWith('OPERATIONAL_QUEUE'))return;
    // An unloaded collection is not an empty cloud collection. Never turn its
    // cached contents into edits/deletions before its own baseline arrives.
    if(this.kinds&&!this.loadedKinds.has(kind))return;
    if(this.trackedRows.get(kind)===rows)return;
    try{const next=new Map(rows.filter(row=>recordIdOf(kind,row)!=='undefined').map(row=>[recordIdOf(kind,row),recordJson(row)])),before=this.previous.get(kind);
      this.trackedRows.set(kind,rows);this.previous.set(kind,next);if(!before||!this.ready)return;
      let changed=false;
      for(const [id,json] of next)if(before.get(id)!==json){this.queue(kind,id,JSON.parse(json),false);changed=true;}
      for(const id of before.keys())if(prune&&!next.has(id)){this.queue(kind,id,null,true);changed=true;}
      if(changed&&this.pending.size){this.persist();this.schedule();}
    }catch{this.error='Penyimpanan operasional gagal; jangan hapus data browser.';this.emit();}
  }
  private schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush(),300);}
  async resolveConflict(choice:'server'|'local',record?:{kind:string;recordId:string}){
    const c=record||this.conflictDetails()[0];if(!c)return;const key=keyFor(c.kind,c.recordId);await this.refresh(false);if(this.stopped||this.error)return;
    // Refresh can replace the pending object; resolve its current version, not an old reference.
    const op=this.pending.get(key);if(!op||!this.conflicts.has(key))return;
    try{if(choice==='server'){this.backup('conflict-resolution',recordJson(op),[{kind:op.kind,recordId:op.recordId,reason:'OWNER_CHOSE_SERVER'}]);this.pending.delete(key);}
      else{if(this.scopeIssue(op))throw Error('WRONG_SECTOR_CANNOT_OVERRIDE');this.pending.set(key,{...op,baseRevision:this.remote.get(key)?.revision||0});}
      this.conflicts.delete(key);this.persist();this.onRecords(this.visible(),false,this.kinds?[...this.loadedKinds]:undefined);await this.flush();
    }catch(error){this.error=error instanceof Error?error.message:'RESOLUTION_FAILED';this.emit();}
  }
  async flush(){
    if(this.inFlight||this.stopped||this.outletBlocked||!navigator.onLine||this.error?.startsWith('OPERATIONAL_QUEUE'))return;
    const operations=[...this.pending].filter(([key,op])=>!this.conflicts.has(key)&&(op.origin!=='legacy'||this.legacyCheckedKeys.has(key))).map(([,op])=>op).slice(0,100);if(!operations.length)return;
    this.inFlight=true;this.emit();
    try{const response=await fetch('/api/v1/sync/state',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify({sector:this.sector,businessId:this.identity?.businessId,outletId:this.outletId,operations})}),data=await response.json();
      if(this.stopped)return;
      if(!response.ok||!data.ok){if(data.error==='STATE_CONFLICT'){this.conflicts.set(keyFor(data.kind,data.recordId),{kind:data.kind,recordId:data.recordId});this.persist();await this.refresh(false);return;}
        if(data.error==='OUTLET_SETUP_REQUIRED')this.outletBlocked=true;throw Error(data.error||`HTTP_${response.status}`);}
      for(const version of data.versions||[]){const key=keyFor(version.kind,version.recordId),sent=operations.find(op=>keyFor(op.kind,op.recordId)===key);if(!sent)continue;
        this.remote.set(key,{scope:globals.has(sent.kind)?'GLOBAL':this.sector,kind:sent.kind,recordId:sent.recordId,value:sent.value,deleted:sent.deleted,revision:version.revision});
        if(this.pending.get(key)===sent)this.pending.delete(key);else{const newer=this.pending.get(key);if(newer)newer.baseRevision=version.revision;}this.conflicts.delete(key);}
      for(const c of data.conflicts||[])this.conflicts.set(keyFor(c.kind,c.recordId),c);
      for(const r of data.rejected||[]){const key=keyFor(r.kind,r.recordId),op=this.pending.get(key);if(!op)continue;
        if(r.error==='WRONG_SCOPE'){this.backup('server-rejected',recordJson(op),[{kind:op.kind,recordId:op.recordId,reason:r.detail||'WRONG_SCOPE'}]);if(this.pending.get(key)===op)this.pending.delete(key);}
        else this.conflicts.set(key,{kind:op.kind,recordId:op.recordId,error:r.error});}
      this.saveBaselines([...new Set((data.versions||[]).map((row:{kind:string})=>row.kind))] as string[]);
      this.error=null;this.lastSyncedAt=new Date().toISOString();this.persist();
    }catch(error){this.error=error instanceof Error?error.message:'STATE_UNAVAILABLE';}finally{this.inFlight=false;this.emit();}
    if(!this.stopped&&this.conflicts.size)await this.refresh(false);
    if(!this.stopped&&!this.error&&[...this.pending.keys()].some(key=>!this.conflicts.has(key)))this.schedule();
  }
}
