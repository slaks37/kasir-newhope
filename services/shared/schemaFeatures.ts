import type { Db } from './db';

/**
 * Optional schema added by additive migrations. Code that reads it checks first,
 * so a deploy that lands before its migration keeps working on the old path
 * instead of failing every request with 42P01/42703.
 *
 * Checked through the catalog (never by catching a failed query: inside a
 * transaction that aborts the whole transaction). Present is cached for the
 * process lifetime; absent is re-checked after a minute so an applied
 * migration is picked up without a redeploy.
 */
const FEATURES = {
  staffAccounts: `SELECT to_regclass('internal.staff_invitations') IS NOT NULL AND to_regclass('internal.staff_workspace_assignments') IS NOT NULL AND EXISTS(SELECT FROM pg_attribute WHERE attrelid=to_regclass('internal.memberships') AND attname='auth_managed' AND NOT attisdropped) AS ok`,
  cashierRegisters: `SELECT (SELECT count(*)=2 FROM pg_policy WHERE polrelid IN(to_regclass('pos.cash_registers'),to_regclass('pos.shifts')) AND polname='workspace_scope' AND position('workspace_modules' in pg_get_expr(polqual,polrelid))>0) AND to_regclass('pos.shift_variance_events') IS NOT NULL AND to_regprocedure('pos.bind_register_money()') IS NOT NULL AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pos.transactions') AND attname='register_shift_id' AND NOT attisdropped) AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pos.shifts') AND attname='close_command' AND NOT attisdropped) AS ok`,
  moduleScopeGuard: `SELECT to_regprocedure('internal.requires_module_scope(uuid)') IS NOT NULL AS ok`,
  merchantActivityAppend: `SELECT to_regprocedure('internal.append_merchant_activity(uuid,uuid,text,text,text,uuid,text,text,numeric,text,jsonb,timestamptz)') IS NOT NULL AS ok`,
  workspaceIsolation: `SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pos.shared_state_records') AND attname='module_id' AND NOT attisdropped) AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pos.products') AND attname='workspace_payload' AND NOT attisdropped) AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pos.inventory_transactions') AND attname='actor_ref' AND NOT attisdropped) AND to_regclass('pos.workspace_commands') IS NOT NULL AND to_regclass('contract.workspace_subscription_metadata') IS NOT NULL AND to_regprocedure('internal.append_merchant_activity(uuid,uuid,text,text,text,uuid,text,text,numeric,text,jsonb,timestamptz)') IS NOT NULL AS ok`,
  moduleAssignments: `SELECT to_regclass('internal.merchant_modules') IS NOT NULL AND to_regclass('internal.outlet_modules') IS NOT NULL AND to_regclass('billing.module_entitlements') IS NOT NULL AS ok`,
  /** migration 0054 / 20261004090200 */
  syncReceiptOutcomes: `SELECT EXISTS (SELECT 1 FROM pg_attribute
    WHERE attrelid = to_regclass('pos.sync_receipts') AND attname = 'outcomes' AND NOT attisdropped) AS ok`,
  /** migration 0055 / 20261004090300 */
  sharedStateVersions: `SELECT to_regclass('pos.shared_state_versions') IS NOT NULL AS ok`,
} as const;

export type SchemaFeature = keyof typeof FEATURES;

const ABSENT_RECHECK_MS = 60_000;
const known = new Map<SchemaFeature, { ok: boolean; at: number }>();

export async function hasSchemaFeature(db: Pick<Db, 'query'>, feature: SchemaFeature, now = Date.now()): Promise<boolean> {
  const cached = known.get(feature);
  if (cached && (cached.ok || now - cached.at < ABSENT_RECHECK_MS)) return cached.ok;
  const ok = Boolean((await db.query(FEATURES[feature])).rows[0]?.ok);
  known.set(feature, { ok, at: now });
  return ok;
}

/** Tests only. */
export function resetSchemaFeatureCache(): void {
  known.clear();
}
