import type { Db } from '../shared/db';
import type { AuthPrincipal } from '../shared/auth';
import type { IntentEntities, MerchantAggregates } from '../../src/lib/assistant/types';
import { reportAggregates } from '../../src/lib/assistant/reportAggregates';
import { loadMerchantSnapshot } from './snapshotData';
export type FieldSource = 'DATABASE' | 'CLIENT' | 'UNAVAILABLE';
export interface MerchantDataResult {
  aggregates: MerchantAggregates | null; tenantId: string | null; storeName: string | null;
  businessSector: string | null; provenance: Record<string, FieldSource>;
}
/** Raw rows never leave this adapter. Tested with full isolated schema and
 * cross-owner denial in test-brain-db; financial math in test-business-brain. */
export async function buildAggregatesFromDb(db: Db, businessId: string, principal: AuthPrincipal, entities: IntentEntities = {}): Promise<MerchantDataResult> {
  const snapshot = await loadMerchantSnapshot(db,principal,businessId);
  const aggregates = reportAggregates(snapshot,entities);
  const provenance: Record<string,FieldSource> = Object.fromEntries(Object.keys(aggregates).map(k=>[k,'DATABASE']));
  for (const key of ['customerCounts','slotsOccupied','slotsTotal','staffOnShift']) provenance[key]='UNAVAILABLE';
  return {aggregates,tenantId:snapshot.tenantId,storeName:snapshot.storeName,businessSector:snapshot.businessSector,provenance};
}
export function mergeWithClient(fromDb: MerchantAggregates, fromClient: MerchantAggregates | undefined, provenance: Record<string,FieldSource>) {
  const aggregates = {...fromDb}; const p = {...provenance};
  if(fromClient) for(const key of ['customerCounts','slotsOccupied','slotsTotal','staffOnShift'] as const) {
    if(fromClient[key]!==undefined){(aggregates as any)[key]=fromClient[key];p[key]='CLIENT';}
  }
  return {aggregates,provenance:p};
}
