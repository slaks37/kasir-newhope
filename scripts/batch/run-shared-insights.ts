import { connectDb, type Db } from '../../services/shared/db';
import { computeDailyBrief, cacheDailyBrief } from '../../services/ai/dailyBrief';

export interface BatchOptions {
  dryRun: boolean;
  limit: number;
  /** Application business reference, resolved with its owner in the database. */
  businessId?: string;
  signal?: AbortSignal;
}

type Dependencies = {
  compute: typeof computeDailyBrief;
  cache: typeof cacheDailyBrief;
  now: () => number;
};

const SKIP_REASONS = new Set([
  'AI_DISABLED_ON_FREE', 'TENANT_SUSPENDED', 'SUBSCRIPTION_EXPIRED', 'SUBSCRIPTION_REQUIRED',
]);

export function parseArgs(argv: string[]): BatchOptions & { help: boolean } {
  const options: BatchOptions & { help: boolean } = { dryRun: false, limit: 25, help: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--limit') {
      const value = argv[++i];
      if (!value || !/^\d+$/.test(value)) throw new Error('INVALID_ARGUMENTS');
      options.limit = Number(value);
    } else if (flag === '--business' || flag === '--merchant') {
      const value = argv[++i];
      if (!value?.trim() || value.startsWith('--') || value.length > 200) throw new Error('INVALID_ARGUMENTS');
      options.businessId = value.trim();
    } else {
      // Reject removed algorithm overrides/fixtures rather than silently using
      // different math from the app. Synthetic tests belong in scripts/dev.
      throw new Error('INVALID_ARGUMENTS');
    }
  }
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error('INVALID_ARGUMENTS');
  }
  return options;
}

/** One explicitly bounded batch; no model calls, messages, or business mutations. */
export async function runSharedInsights(
  db: Db,
  options: BatchOptions,
  overrides: Partial<Dependencies> = {},
) {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error('INVALID_ARGUMENTS');
  }
  const { compute, cache, now } = {
    compute: computeDailyBrief, cache: cacheDailyBrief, now: Date.now, ...overrides,
  };
  const started = now();
  const deadline = started + 60_000;
  const merchants = await db.tx(async tx => {
    await tx.exec('SET TRANSACTION READ ONLY');
    await tx.exec("SET LOCAL statement_timeout = '10s'");
    return (await tx.query<{ id: string; external_ref: string; owner_user_ref: string }>(`
      SELECT m.id,m.external_ref,t.owner_user_ref
      FROM internal.merchants m
      JOIN internal.tenants t ON t.id=m.tenant_id
      LEFT JOIN ai.business_intelligence_cache c ON c.merchant_id=m.id
      WHERE m.external_ref IS NOT NULL AND t.owner_user_ref IS NOT NULL
        AND ($1::text IS NULL OR m.external_ref=$1)
      ORDER BY c.generated_at ASC NULLS FIRST,m.id LIMIT $2`,
      [options.businessId ?? null, options.limit])).rows;
  });

  let processed = 0, computed = 0, written = 0, skipped = 0, failed = 0, attemptRecorded = 0;
  for (const merchant of merchants) {
    // Stop between businesses, never leave a partially written document.
    if (options.signal?.aborted || now() >= deadline) break;
    processed++;
    try {
      await db.tx(async tx => {
        if (options.dryRun) await tx.exec('SET TRANSACTION READ ONLY');
        await tx.exec("SET LOCAL statement_timeout = '10s'");
        // The owner is loaded internally, not supplied as a CLI member override.
        // computeDailyBrief rechecks ownership and Free/expired entitlements.
        const document = await compute(tx, { subject: merchant.owner_user_ref }, merchant.external_ref);
        if (!options.dryRun) await cache(tx, document);
      });
      computed++;
      if (!options.dryRun) written++;
    } catch (error) {
      const skip = error instanceof Error && SKIP_REASONS.has(error.message);
      if (skip) skipped++; else failed++;
      if (!options.dryRun) {
        // Rotate ineligible/failed businesses too; otherwise they repeatedly
        // occupy the first batch. Never replace failure with invented zeros.
        try {
          await db.tx(async tx => {
            await tx.exec("SET LOCAL statement_timeout = '10s'");
            await tx.query(`INSERT INTO ai.business_intelligence_cache
              (merchant_id,algorithm_version,generated_at,document)
              VALUES($1,'unavailable',now(),$2::jsonb)
              ON CONFLICT(merchant_id) DO UPDATE SET
                algorithm_version=EXCLUDED.algorithm_version,
                generated_at=EXCLUDED.generated_at,document=EXCLUDED.document`,
            [merchant.id, JSON.stringify({ status: skip ? 'SKIPPED' : 'UNAVAILABLE' })]);
          });
          attemptRecorded++;
        } catch {
          // Include persistence failure without exposing the underlying SQL.
          if (skip) failed++;
        }
      }
    }
  }

  return {
    mode: options.dryRun ? 'DRY_RUN' : 'LIVE',
    selected: merchants.length, processed, computed, written, skipped, failed, attemptRecorded,
    deferred: merchants.length - processed,
    durationMs: Math.max(0, now() - started),
  };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let options: ReturnType<typeof parseArgs>;
  try { options = parseArgs(argv); }
  catch {
    console.error('INVALID_ARGUMENTS: use --help for supported options.');
    return 2;
  }
  if (options.help) {
    console.log(`Shared daily business intelligence batch (no AI API tokens).

  --dry-run          Read configured DB in READ ONLY transactions; write nothing.
  --business <ref>   Process one application business reference.
  --merchant <ref>   Alias of --business; not an override of the owner/member ID.
  --limit <1-100>    Maximum businesses per run (default 25).

DATABASE_URL is required in both modes. No demo-data fallback.
Only counts are logged. Live mode writes derived summaries/status to the cache.
The job stops between businesses after about 60 seconds; rerun for the next batch.
Legacy --input, --window and --lead-time overrides are no longer supported.`);
    return 0;
  }
  if (!process.env.DATABASE_URL?.trim()) {
    console.error('DATABASE_URL_REQUIRED: no database was contacted.');
    return 2;
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let db: Db | undefined;
  try {
    db = await connectDb({ schema: 'ai', max: 1 });
    const result = await runSharedInsights(db, { ...options, signal: controller.signal });
    console.log(JSON.stringify(result));
    return controller.signal.aborted ? 130 : result.failed || result.deferred ? 1 : 0;
  } catch {
    console.error('DAILY_INSIGHTS_FAILED: no business data is included in this log.');
    return 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await db?.close();
  }
}
