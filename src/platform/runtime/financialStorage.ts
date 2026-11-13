import {isNative} from './platform';
export interface FinancialDisk {
 load():Promise<{deviceId:string;entries:Array<{key:string;value:string}>}>;
 compareAndSet(options:{key:string;expected:string|null;value:string|null}):Promise<void>;
}
let disk:FinancialDisk|undefined,deviceId='',ready=false;
const cache=new Map<string,string>();
export async function initializeFinancialStorage(adapter?:FinancialDisk){
 if(!isNative()&&!adapter)return;
 ready=false;deviceId='';cache.clear();
 disk=adapter||(await import('@capacitor/core')).registerPlugin<FinancialDisk>('FinancialDisk');
 const snapshot=await disk.load();if(!snapshot.deviceId)throw Error('NATIVE_DEVICE_ID_REQUIRED');
 cache.clear();for(const entry of snapshot.entries)cache.set(entry.key,entry.value);deviceId=snapshot.deviceId;ready=true;
}
function requireReady(){if(!ready||!disk)throw Error('NATIVE_FINANCIAL_STORAGE_NOT_READY');}
export const financialDeviceId=()=>{requireReady();return deviceId;};
export function readFinancialValue(key:string):string|null{
 if(!isNative())return localStorage.getItem(key);requireReady();return cache.get(key)??null;
}
/** Resolve only after SQLite COMMIT. CAS refuses competing changes; no stale overwrite. */
export async function writeFinancialValue(key:string,value:string|null){
 if(!isNative()){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);return;}
 requireReady();const expected=cache.get(key)??null;
 await disk!.compareAndSet({key,expected,value});
 if(value===null)cache.delete(key);else cache.set(key,value);
}
export function assertBrowserFinancialWrite(){if(isNative())throw Error('NATIVE_DURABLE_WRITE_REQUIRED');}
