import type { BusinessSector, CashMovement } from '../../types';
import type { SyncStatus, SyncTarget } from './queue';
import { legacyFinancialHolds } from './legacyHold';

const PREFIX = 'newhope_cash_outbox_';
const META = 'newhope_cash_sync_meta_';
const ACK = 'newhope_legacy_cash_ack_';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type CashEvent = {
  sector: BusinessSector; outletId: string; clientEventId: string;
  type: 'CASH_IN' | 'CASH_OUT' | 'OPENING'; amount: number;
  category: string; description: string; occurredAt: string;
  shiftId?: string; recipientOrSource?: string; actorName?: string;
};
type CashReversal = {
  sector: BusinessSector; outletId: string; clientEventId: string; originalEventId: string; reason: string;
};
export type CashCommand = (
  | { action: 'cash'; body: CashEvent }
  | { action: 'reverse'; body: CashReversal }
  | { action: 'refund'; body: { sector:BusinessSector;outletId:string;clientEventId:string;clientTxnId:string;
      refund:{clientRefundId:string;occurredAt:string;refundMethod:'CASH'|'ORIGINAL_METHOD';reason:string;items:Array<{clientItemId:string;quantity:number}>} } }
) & { legacyMigration?: { sourceKey: string; fingerprint: string; originalBranchRef?: string } };

function fingerprint(command: CashCommand): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, canonical(value)])) : v;
  return JSON.stringify(canonical({ action: command.action, body: command.body }));
}
function read(businessId: string): CashCommand[] {
  const raw = localStorage.getItem(`${PREFIX}${businessId}`);
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parsed; } catch { /* Preserve corrupt bytes. */ }
  throw new Error('LOCAL_CASH_QUEUE_CORRUPT');
}
function write(businessId: string, rows: CashCommand[]): void {
  try { localStorage.setItem(`${PREFIX}${businessId}`, JSON.stringify(rows)); }
  catch { throw new Error('LOCAL_CASH_QUEUE_WRITE_FAILED'); }
}
function meta(businessId: string): Omit<SyncStatus, 'pending' | 'inFlight'> {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${META}${businessId}`) || '{}');
    return { lastSyncedAt: parsed.lastSyncedAt || null, lastError: parsed.lastError || null, lastErrorAt: parsed.lastErrorAt || null, failures: Number(parsed.failures) || 0 };
  } catch { return { lastSyncedAt: null, lastError: null, lastErrorAt: null, failures: 0 }; }
}
function writeMeta(businessId: string, patch: Partial<SyncStatus>): void {
  try { localStorage.setItem(`${META}${businessId}`, JSON.stringify({ ...meta(businessId), ...patch })); } catch { /* Queue durability is independent. */ }
}
const flushing = new Set<string>();
export function pendingRefund(businessId:string,transactionId:string):boolean {
  return read(businessId).some(command=>command.action==='refund'&&command.body.clientTxnId===transactionId);
}
export function refundAcknowledgment(businessId:string,eventId:string):any {
  const raw=localStorage.getItem(`newhope_refund_ack_${businessId}_${eventId}`);
  return raw?JSON.parse(raw):null;
}
export function getCashSyncStatus(businessId: string): SyncStatus {
  const current = meta(businessId);
  try { return { ...current, pending: read(businessId).length, inFlight: flushing.has(businessId) }; }
  catch (error) { return { ...current, pending: 1, inFlight: false, failures: Math.max(1, current.failures), lastError: error instanceof Error ? error.message : 'LOCAL_CASH_QUEUE_READ_FAILED' }; }
}
export function enqueueCashCommand(businessId: string, command: CashCommand): void {
  const rows = read(businessId);
  const existing = rows.find(row => row.body.clientEventId === command.body.clientEventId);
  if (existing && fingerprint(existing) !== fingerprint(command)) throw new Error('CASH_EVENT_ID_CONFLICT');
  if (!existing) rows.push(command);
  else if (command.legacyMigration) existing.legacyMigration = command.legacyMigration;
  write(businessId, rows);
}
export function cashMovementToCommand(sector: BusinessSector, movement: CashMovement, outletId: string): CashCommand {
  return { action: 'cash', body: {
    sector, outletId, clientEventId: movement.id,
    type: movement.category === 'MODAL_AWAL' && movement.type === 'CASH_IN' ? 'OPENING' : movement.type,
    amount: movement.amount, category: movement.category, description: movement.description,
    occurredAt: movement.timestamp, shiftId: movement.shiftId,
    recipientOrSource: movement.recipientOrSource, actorName: movement.cashierName,
  } };
}
export function legacyCashAcknowledged(businessId: string, sourceKey: string, command: CashCommand): boolean {
  try { return JSON.parse(localStorage.getItem(`${ACK}${businessId}`) || '{}')[sourceKey]?.[command.body.clientEventId] === fingerprint(command); }
  catch { return false; }
}
export function enqueueLegacyCashCommand(businessId: string, sourceKey: string, command: CashCommand, originalBranchRef: string): void {
  const rows = read(businessId);
  const existing = rows.find(row => row.body.clientEventId === command.body.clientEventId);
  const marked = { ...command, legacyMigration: { sourceKey, fingerprint: fingerprint(command), originalBranchRef } };
  if (existing && fingerprint(existing) !== fingerprint(command)) {
    const sameExceptOutlet = fingerprint({ ...existing, body: { ...existing.body, outletId: '' } } as CashCommand) === fingerprint({ ...command, body: { ...command.body, outletId: '' } } as CashCommand);
    if (!sameExceptOutlet || existing.legacyMigration?.sourceKey !== sourceKey || existing.legacyMigration?.originalBranchRef !== originalBranchRef) throw new Error('CASH_EVENT_ID_CONFLICT');
    rows[rows.indexOf(existing)] = marked;
    write(businessId, rows);
  } else enqueueCashCommand(businessId, marked);
}
export async function flushCashQueue(target: SyncTarget, force = false): Promise<SyncStatus> {
  const businessId = target.businessId;
  if (flushing.has(businessId)) return getCashSyncStatus(businessId);
  let rows: CashCommand[];
  let held:Set<string>;
  try { rows = read(businessId); held=new Set(legacyFinancialHolds(businessId).cash_movements); }
  catch(error) {
    writeMeta(businessId,{lastError:error instanceof Error?error.message:'LOCAL_CASH_QUEUE_READ_FAILED',failures:1,lastErrorAt:new Date().toISOString()});
    return getCashSyncStatus(businessId);
  }
  if (!rows.length) return getCashSyncStatus(businessId);
  const state = meta(businessId);
  if (!force && state.lastError?.startsWith('OUTLET_SETUP_REQUIRED')) return getCashSyncStatus(businessId);
  if (!force && state.failures && state.lastErrorAt && Date.now() - Date.parse(state.lastErrorAt) < Math.min(300_000, 5_000 * 3 ** Math.min(state.failures - 1, 4))) return getCashSyncStatus(businessId);
  flushing.add(businessId);
  try {
    for (const command of rows.filter(command=>!command.legacyMigration||!held.has(command.body.clientEventId)).slice(0, 100)) {
      if (!UUID.test(command.body.outletId)) continue;
      if (command.body.sector !== target.sector) throw new Error('CASH_SCOPE_MISMATCH');
      const response = await fetch(`/api/v1/finance/${command.action === 'reverse' ? 'cash/reverse' : command.action}`, {
        method: 'POST', signal:AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command.body),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error ? `${data.error} (HTTP ${response.status})` : `HTTP ${response.status}`);
      if(command.action==='refund')localStorage.setItem(`newhope_refund_ack_${businessId}_${command.body.clientEventId}`,JSON.stringify(data.refund));
      if (command.legacyMigration) {
        const key = `${ACK}${businessId}`;
        const ack = JSON.parse(localStorage.getItem(key) || '{}');
        const source = command.legacyMigration;
        ack[source.sourceKey] = { ...ack[source.sourceKey], [command.body.clientEventId]: source.fingerprint };
        localStorage.setItem(key, JSON.stringify(ack));
      }
      const sent = fingerprint(command);
      write(businessId, read(businessId).filter(current => current.body.clientEventId !== command.body.clientEventId || fingerprint(current) !== sent));
      writeMeta(businessId, { lastSyncedAt: new Date().toISOString(), lastError: null, lastErrorAt: null, failures: 0 });
    }
    const pending = read(businessId);
    if(pending.some(command=>command.legacyMigration&&held.has(command.body.clientEventId))){
      writeMeta(businessId,{lastError:'LEGACY_FINANCIAL_REVIEW_REQUIRED',failures:1,lastErrorAt:new Date().toISOString()});
    } else if (pending.some(command => !UUID.test(command.body.outletId))) {
      writeMeta(businessId, { lastError: 'LEGACY_OUTLET_MAPPING_REQUIRED', failures: 1, lastErrorAt: new Date().toISOString() });
    }
  } catch (error) {
    writeMeta(businessId, { lastError: error instanceof Error ? error.message : 'CASH_SYNC_FAILED', lastErrorAt: new Date().toISOString(), failures: state.failures + 1 });
  } finally { flushing.delete(businessId); }
  const after = getCashSyncStatus(businessId);
  return after.pending && !after.failures ? flushCashQueue(target) : after;
}

export function combineFinancialSyncStatus(transactions: SyncStatus, cash: SyncStatus): SyncStatus {
  const lastSyncedAt = [transactions.lastSyncedAt, cash.lastSyncedAt].filter(Boolean).sort().at(-1) || null;
  const failed = transactions.lastError ? transactions : cash;
  return { pending: transactions.pending + cash.pending, inFlight: transactions.inFlight || cash.inFlight,
    lastSyncedAt, failures: Math.max(transactions.failures, cash.failures), lastError: failed.lastError, lastErrorAt: failed.lastErrorAt };
}
