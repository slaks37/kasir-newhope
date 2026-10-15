import {verifiedNeonTarget} from '../shared/neonTargets';

/** No remote fallback to the application's writer. A catalog restore is not
 * an empty database, even if its historical migration registry is incomplete. */
export function migrationConnection(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VERCEL_ENV === 'production' || (env.NODE_ENV === 'production' && env.APP_ENV !== 'staging'))
    throw Error('MIGRATION_PRODUCTION_TARGET_BLOCKED');
  const value = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/postgres';
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash ||
      [...url.searchParams.keys()].some(k => !['sslmode', 'channel_binding', 'application_name'].includes(k)))
    throw Error('MIGRATION_CONNECTION_REJECTED');
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return value;
  if (env.VERCEL_ENV === 'production' || env.APP_ENV !== 'staging' ||
      env.NEON_MIGRATION_CONFIRM !== 'REVIEWED_STAGING_MIGRATIONS' || !env.DATABASE_URL_UNPOOLED)
    throw Error('MIGRATION_REMOTE_TARGET_NOT_APPROVED');
  const target = verifiedNeonTarget(env);
  if (url.hostname !== target.host || url.pathname !== '/' + target.database ||
      (url.port && url.port !== '5432')) throw Error('MIGRATION_DIRECT_ENDPOINT_REQUIRED');
  return value;
}

export function assertMigrationBaseline(files: readonly string[], done: ReadonlySet<string>, populated: boolean, incrementalLocal = false): void {
  // Restores can contain a few early markers AND the complete business catalog.
  // Those markers do not authorize replay of every later historical migration.
  const required = incrementalLocal ? files.slice(0, 3) : files;
  if (populated && required.some(file => !done.has(file)))
    throw Error('MIGRATION_BASELINE_REVIEW_REQUIRED: populated catalog has incomplete history; use reviewed corrective migrations, never replay bootstrap');
}
