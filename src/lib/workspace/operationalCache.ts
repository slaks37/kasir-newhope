import {partitionKey,accountKey} from '../../context/TenantContext';
import type {StaffMember} from '../../types';
import {operationalKinds} from '../sync/operationalScope';
import {repairOperationalCache,operationalCacheBlocked} from '../sync/operationalRecovery';
const financial=new Set(['orders','cash_movements','shift','shift_history']);
/** Lazy operational cache, not a financial authority. Unloaded collections are
 * not empty collections and cannot overwrite their retained browser source. */
export class WorkspaceCache {
  private loaded=new Set<string>();
  private initialValues=new Map<string,unknown>();
  constructor(readonly owner:string,readonly sector:string,readonly businessId:string,readonly namespace?:string){}
  key(entity:string){return partitionKey(this.businessId,entity);}
  load<T>(entity:string,fallback:T,allowed:readonly string[]):T{
    if(!allowed.includes(entity))return fallback;
    return this.hydrate(entity,fallback);
  }
  hydrate<T>(entity:string,fallback:T):T{
    if(this.initialValues.has(entity))return this.initialValues.get(entity) as T;
    const raw=localStorage.getItem(this.key(entity));
    // Backup/repair must succeed before enabling persistence for this cache.
    const value=raw?repairOperationalCache(this.owner,this.sector,entity,JSON.parse(raw),{businessId:this.businessId,namespace:this.namespace}):fallback;
    this.loaded.add(entity);this.initialValues.set(entity,value);return value;
  }
  loadRoster(allowed:readonly string[]):StaffMember[]{return allowed.includes('staff_members')?this.hydrateRoster():[];}
  hydrateRoster():StaffMember[]{
    const entity='GLOBAL:staff_members';
    if(this.initialValues.has(entity))return this.initialValues.get(entity) as StaffMember[];
    const raw=localStorage.getItem(accountKey(this.owner,'staff_members')),rows=raw?JSON.parse(raw):[];
    if(!Array.isArray(rows))throw Error('STAFF_CACHE_INVALID');
    this.initialValues.set(entity,rows);this.loaded.add(entity);return rows;
  }
  writeRoster(rows:StaffMember[]){
    if(!this.loaded.has('GLOBAL:staff_members'))return;
    const key=accountKey(this.owner,'staff_members'),raw=JSON.stringify(rows);
    if(localStorage.getItem(key)!==raw)localStorage.setItem(key,raw);
  }
  // The POS bootstrap reads recent transactions and shifts, not a cash-ledger
  // history. Never overwrite retained cash source bytes with an empty cache.
  confirmFinancialHydration(){for(const entity of ['orders','shift','shift_history'])this.loaded.add(entity);}
  write(key:string,json:string){
    const prefix=partitionKey(this.businessId,'');
    const entity=key.startsWith(prefix)?key.slice(prefix.length):null;
    if(entity&&(operationalKinds.has(entity)||financial.has(entity))&&!this.loaded.has(entity))return;
    if(operationalCacheBlocked(key))return;
    if(localStorage.getItem(key)!==json)localStorage.setItem(key,json);
  }
}
