import { operationalKinds,operationalScopeIssue } from './operationalScope';
export type OperationalRecovery={sourceKey:string;raw:string;capturedAt:string;records:Array<{kind:string;recordId:string;reason:string;name?:string}>};
const key=(owner:string,sector:string)=>`newhope_operational_recovery_v2_${owner}_${sector}`;
const blockedSources=new Set<string>();
export const operationalCacheBlocked=(sourceKey:string)=>blockedSources.has(sourceKey);
export const operationalCacheError=(owner:string,sector:string)=>[...blockedSources].some(k=>k.startsWith(`newhope_data_${owner}_${sector}_`))
  ?'Cadangan operasional gagal disimpan. Data asli dilindungi; kosongkan ruang penyimpanan, jangan hapus data browser.':null;
export function operationalRecovery(owner:string,sector:string):OperationalRecovery[]{
  const raw=localStorage.getItem(key(owner,sector));if(!raw)return [];
  const rows=JSON.parse(raw);if(!Array.isArray(rows))throw new Error('OPERATIONAL_RECOVERY_INVALID');return rows;
}
/** Backup must commit before the caller removes anything from active operational state. No pruning. */
export function backupOperational(owner:string,sector:string,sourceKey:string,raw:string,records:OperationalRecovery['records']):void {
  const rows=operationalRecovery(owner,sector);
  if(rows.some(row=>row.sourceKey===sourceKey&&row.raw===raw))return;
  rows.push({sourceKey,raw,capturedAt:new Date().toISOString(),records});
  localStorage.setItem(key(owner,sector),JSON.stringify(rows));
}
export function repairOperationalCache<T>(owner:string,sector:string,kind:string,value:T):T {
  if(!operationalKinds.has(kind)||(!Array.isArray(value)&&kind!=='store_settings'))return value;
  const rows=Array.isArray(value)?value:[value];
  const wrong=rows.flatMap(row=>{
    const id=String(row?.id??row?.code??row?.staffId??'');
    const reason=operationalScopeIssue(owner,sector,kind,id,row);
    return reason?[{kind,recordId:id,reason,name:typeof row?.name==='string'?row.name:undefined}]:[];
  });
  if(!wrong.length)return value;
  const sourceKey=`newhope_data_${owner}_${sector}_${kind}`,raw=localStorage.getItem(sourceKey)||JSON.stringify(value);
  try{
    backupOperational(owner,sector,sourceKey,raw,wrong);
    const cleaned=Array.isArray(value)?rows.filter(row=>!operationalScopeIssue(owner,sector,kind,String(row?.id??row?.code??row?.staffId??''),row)):{};
    localStorage.setItem(sourceKey,JSON.stringify(cleaned));blockedSources.delete(sourceKey);return cleaned as T;
  }catch(error){blockedSources.add(sourceKey);throw error;}
}
