import type { SyncStatus } from './queue';
import type { SharedSyncStatus } from './sharedState';
import type { LegacyMigrationResult } from './legacyMigration';
export function syncStatusModel(input:{businessId:string;financial:SyncStatus;operational:SharedSyncStatus;
  recovery:LegacyMigrationResult|null;cloudReady:boolean;cloudError:string|null;online:boolean}){
  const {financial:f,operational:o,recovery:r}=input;
  const financialReview=Boolean(r&&!r.complete&&(r.conflicts||r.needsOutletMapping||r.invalid||r.deferredRefunds||r.unassignedSourceKeys.length));
  const expectedHold=!!f.lastError&&/^(LEGACY_OUTLET_MAPPING_REQUIRED|LEGACY_FINANCIAL_REVIEW_REQUIRED|OUTLET_SETUP_REQUIRED)/.test(f.lastError);
  const error=input.cloudError||o.error||(expectedHold?null:f.lastError);
  const review=financialReview||expectedHold||!!o.conflicts?.length||!!o.conflict;
  const phase=!input.online?'offline':error?'error':review?'review':f.inFlight||o.inFlight?'syncing'
    :f.pending||o.pending?'pending':!input.cloudReady||!o.ready?'connecting':'synced';
  const label={offline:'Offline',error:'Sync bermasalah',review:'Perlu tindakan',syncing:'Menyinkronkan…',pending:'Menunggu sinkronisasi',connecting:'Menghubungkan cloud…',synced:'Cloud Synced'}[phase];
  const times=[f.lastSyncedAt,o.lastSyncedAt].filter((v):v is string=>!!v&&Number.isFinite(Date.parse(v))).sort();
  return {...input,phase,label,error,financialReview,financialPending:f.pending,operationalPending:o.pending,
    operationalConflicts:o.conflicts|| (o.conflict?[o.conflict]:[]),lastConfirmedAt:times.at(-1)||null,
    detail:`${f.pending} transaksi keuangan · ${o.pending} perubahan operasional`};
}
export type SyncCenterModel=ReturnType<typeof syncStatusModel>;
