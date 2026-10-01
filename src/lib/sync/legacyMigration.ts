import type { Order, CashMovement } from '../../types';
import { cashMovementToCommand, legacyCashAcknowledged, enqueueLegacyCashCommand } from './financialQueue';
import { makeBusinessId, partitionKey } from '../../context/TenantContext';
import {
  enqueueLegacyTransaction, financialPayloadFingerprint, isLegacyTransactionAcknowledged,
  orderToPayload, type SyncTarget,
} from './queue';

const SNAPSHOT_PREFIX = 'newhope_legacy_financial_v1_';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LegacySnapshot {
  version: 1;
  businessId: string;
  sourceKey: string;
  capturedAt: string;
  /** Exact original bytes are retained even if the live cache is later replaced. */
  ordersRaw: string | null;
  cashMovementsRaw: string | null;
  retiredOutboxRaw?: string | null;
  blockedIds: string[];
  transactionsAcknowledgedAt?: string;
}

export interface LegacyMigrationResult {
  captured: boolean;
  queued: number;
  acknowledged: number;
  skippedUnpaid: number;
  deferredRefunds: number;
  deferredCashMovements: number;
  needsOutletMapping: number;
  conflicts: number;
  invalid: number;
  complete: boolean;
  error: string | null;
  /** Discovered only; these keys are never assigned to the current owner. */
  unassignedSourceKeys: string[];
  unmappedOutletRefs: string[];
}

export interface LegacyMigrationOptions {
  /** Explicit mappings verified against this owner's active server outlets. */
  outletMappings?: Record<string, string>;
}

function parseRows(raw: string | null): unknown[] {
  if (!raw) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error('LEGACY_SOURCE_INVALID');
  return rows;
}

/**
 * Capture once, enqueue repeatedly until acknowledged. Run before replacing the
 * device's orders cache with server records, and again after a successful flush.
 * The source key proves the owner+sector; cashier-scoped/unscoped keys require
 * an explicit recovery flow and are never silently moved between identities.
 */
export function migrateLegacyFinancialData(target: SyncTarget, options: LegacyMigrationOptions = {}): LegacyMigrationResult {
  const result: LegacyMigrationResult = {
    captured: false, queued: 0, acknowledged: 0, skippedUnpaid: 0, deferredRefunds: 0,
    deferredCashMovements: 0, needsOutletMapping: 0, conflicts: 0, invalid: 0,
    complete: false, error: null, unassignedSourceKeys: [],unmappedOutletRefs:[],
  };
  if (!target.ownerRef || target.businessId !== makeBusinessId(target.ownerRef, target.sector)) {
    result.error = 'LEGACY_OWNER_SCOPE_MISMATCH';
    return result;
  }
  const sourceKey = partitionKey(target.businessId, 'orders');
  const snapshotKey = `${SNAPSHOT_PREFIX}${target.businessId}`;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key !== sourceKey && (key === 'newhope_orders' ||
          (key.startsWith('newhope_data_') && key.endsWith(`_${target.sector}_orders`) &&
           !UUID.test(key.slice('newhope_data_'.length,-`_${target.sector}_orders`.length))))) {
        result.unassignedSourceKeys.push(key);
      }
    }
    const saved = localStorage.getItem(snapshotKey);
    let snapshot: LegacySnapshot;
    if (saved) {
      snapshot = JSON.parse(saved);
      if (snapshot.version !== 1 || snapshot.businessId !== target.businessId || snapshot.sourceKey !== sourceKey ||
          !Array.isArray(snapshot.blockedIds)) throw new Error('LEGACY_SNAPSHOT_INVALID');
    } else {
      snapshot = {
        version: 1, businessId: target.businessId, sourceKey, capturedAt: new Date().toISOString(),
        ordersRaw: localStorage.getItem(sourceKey),
        cashMovementsRaw: localStorage.getItem(partitionKey(target.businessId, 'cash_movements')),
        retiredOutboxRaw: localStorage.getItem('newhope_retired_financial_outbox_'+target.ownerRef+'_'+target.sector),
        blockedIds: [],
      };
      // Validate before writing anything. Original malformed data stays intact.
      parseRows(snapshot.ordersRaw);
      parseRows(snapshot.cashMovementsRaw);
      localStorage.setItem(snapshotKey, JSON.stringify(snapshot));
    }
    if(snapshot.retiredOutboxRaw==null){
      const retired=localStorage.getItem('newhope_retired_financial_outbox_'+target.ownerRef+'_'+target.sector);
      if(retired!==null){parseRows(retired);snapshot.retiredOutboxRaw=retired;
        localStorage.setItem(snapshotKey,JSON.stringify(snapshot));}
    }
    result.captured = true;
    const cashSourceKey=partitionKey(target.businessId,'cash_movements');
    // Older builds also kept pending financial rows in the shared-state outbox.
    // Capture those bytes, import missing rows, and flag competing versions:
    // a deletion operation must never erase a historical financial event.
    const retired=parseRows(snapshot.retiredOutboxRaw??null);
    const recover=(kind:string,raw:string|null):unknown[]=>{
      const rows=parseRows(raw),byId=new Map(rows.map(row=>[(row as any)?.id,row]));
      for(const operation of retired as any[]){
        if(operation?.kind!==kind||operation.deleted||!operation.value)continue;
        const candidate=operation.value,previous=byId.get(candidate.id);
        if(previous&&JSON.stringify(previous)!==JSON.stringify(candidate)){
          result.conflicts++;continue;
        }
        if(!previous){rows.push(candidate);byId.set(candidate.id,candidate);}
      }
      return rows;
    };
    for(const raw of recover('cash_movements',snapshot.cashMovementsRaw)){
      const movement=raw as CashMovement;
      if(!movement || typeof movement.id!=='string'||!movement.id || !Number.isFinite(movement.amount)||movement.amount<=0||
        !Number.isFinite(Date.parse(movement.timestamp))||!['CASH_IN','CASH_OUT'].includes(movement.type)){
        result.invalid++;result.deferredCashMovements++;continue;
      }
      const original=movement.branchId||'__unassigned__';
      const outlet=options.outletMappings?.[original]||movement.branchId||'';
      if(!UUID.test(outlet)){result.deferredCashMovements++;result.needsOutletMapping++;result.unmappedOutletRefs.push(original);continue;}
      const command=cashMovementToCommand(target.sector,movement,outlet);
      if(legacyCashAcknowledged(target.businessId,cashSourceKey,command))continue;
      enqueueLegacyCashCommand(target.businessId,cashSourceKey,command,original);
      result.deferredCashMovements++;
    }
    const rows = recover('orders',snapshot.ordersRaw);
    const seen = new Set<string>();
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') { result.invalid++; continue; }
      const order = raw as Order;
      if (order.status === 'HOLD' || order.paymentStatus === 'PENDING') { result.skippedUnpaid++; continue; }
      const hasRefunds = Boolean(order.refunds?.length);
      const refundIds = new Set<string>();
      if ((order.paymentStatus === 'REFUNDED' || (order.refundTotal || 0) > 0) && !hasRefunds ||
          hasRefunds && (!Array.isArray(order.items) || order.refunds!.some(refund => {
            const duplicate = refundIds.has(refund.id);
            refundIds.add(refund.id);
            return duplicate || !refund.id || !Number.isFinite(Date.parse(refund.timestamp)) ||
              !['CASH', 'ORIGINAL_METHOD'].includes(refund.refundMethod) || !Array.isArray(refund.items) || !refund.items.length ||
              refund.items.some(item => !item.cartItemId || !order.items.some(line => line.id === item.cartItemId) || !Number.isFinite(item.quantity) || item.quantity <= 0 || Math.abs(item.quantity*1000-Math.round(item.quantity*1000))>0.001);
          }))) { result.deferredRefunds++; continue; }
      const paid = order.status === 'COMPLETED' && order.paymentStatus === 'PAID';
      const voided = order.status === 'VOID' && ['PAID', 'CANCELLED'].includes(order.paymentStatus);
      const refunded = hasRefunds && ['COMPLETED', 'VOID'].includes(order.status) && ['PAID', 'REFUNDED'].includes(order.paymentStatus);
      if ((!paid && !voided && !refunded) || typeof order.id !== 'string' || !order.id || order.id.length > 64 ||
          (order.businessSector && order.businessSector !== target.sector) || !Number.isFinite(Date.parse(order.date)) ||
          !Array.isArray(order.items) || !order.items.length ||
          ![order.subtotal, order.discountTotal, order.taxTotal, order.total].every(n => Number.isFinite(n) && n >= 0) ||
          !order.items.every(item => item && typeof item.productId === 'string' && typeof item.name === 'string' &&
            [item.unitPrice, item.totalPrice].every(n => Number.isFinite(n) && n >= 0) && Number.isFinite(item.quantity) && item.quantity > 0)) {
        result.invalid++; continue;
      }
      if (seen.has(order.id)) { result.invalid++; continue; }
      seen.add(order.id);
      if (snapshot.blockedIds.includes(order.id)) { result.conflicts++; continue; }
      const payload = orderToPayload(order);
      const originalBranchRef = order.branchId || '__unassigned__';
      const mappedBranch = options.outletMappings?.[originalBranchRef];
      if (mappedBranch && !UUID.test(mappedBranch)) { result.invalid++; continue; }
      // Do not use target.outletId: the currently selected outlet need not be
      // the outlet where this historical transaction actually happened.
      payload.branchId = mappedBranch || order.branchId;
      const fingerprint = financialPayloadFingerprint(payload);
      if (isLegacyTransactionAcknowledged(target.businessId, sourceKey, order.id, fingerprint)) {
        result.acknowledged++; continue;
      }
      payload.legacyMigration = { sourceKey, fingerprint, originalBranchRef };
      const queued = enqueueLegacyTransaction(target.businessId, payload);
      if (queued === 'conflict') {
        snapshot.blockedIds.push(order.id);
        localStorage.setItem(snapshotKey, JSON.stringify(snapshot));
        result.conflicts++; continue;
      }
      result.queued++;
      if (!UUID.test(payload.branchId || '')) {result.needsOutletMapping++;result.unmappedOutletRefs.push(originalBranchRef);}
    }
    const transactionImportFinished = result.queued === 0 && result.invalid === 0 && result.conflicts === 0 && result.deferredRefunds === 0;
    if (transactionImportFinished && !snapshot.transactionsAcknowledgedAt) {
      // A checkpoint is written only once every eligible sale has server ACK.
      // Empty sources are harmless, but cash/refund completion is separate.
      snapshot.transactionsAcknowledgedAt = new Date().toISOString();
      localStorage.setItem(snapshotKey, JSON.stringify(snapshot));
    }
    result.unmappedOutletRefs=[...new Set(result.unmappedOutletRefs)];
    result.complete = transactionImportFinished && result.deferredCashMovements === 0 && result.unassignedSourceKeys.length === 0;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'LEGACY_MIGRATION_FAILED';
  }
  return result;
}
