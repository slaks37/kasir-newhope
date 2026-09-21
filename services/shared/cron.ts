/** Optional deployment allowlist; undefined preserves existing installations. */
export function isCronJobEnabled(job: string): boolean {
  const configured = process.env.CRON_ENABLED_JOBS;
  if (configured === undefined) return true;
  return configured.split(',').map(value => value.trim()).filter(Boolean).includes(job);
}
