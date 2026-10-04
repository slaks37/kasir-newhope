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
