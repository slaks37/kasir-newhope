export function rehearsalPostgresMajor(env = process.env) {
  const major = env.NEW_HOPE_REHEARSAL_POSTGRES_MAJOR ?? '17';
  if (!['17', '18'].includes(major)) throw new Error('Unsupported PostgreSQL rehearsal major');
  return Number(major);
}

// Deliberately narrower than a general staging client: no remote targets or env fallback.
export function rehearsalTarget(env) {
  if (env.NEW_HOPE_REHEARSAL_CONFIRM !== `DISPOSABLE_POSTGRES${rehearsalPostgresMajor(env)}`) throw new Error('Disposable rehearsal confirmation required');
  if (!env.NEW_HOPE_REHEARSAL_DATABASE_URL) throw new Error('Dedicated rehearsal URL required; DATABASE_URL is never used');
  const url = new URL(env.NEW_HOPE_REHEARSAL_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '55432' ||
      url.pathname !== '/newhope_security_rehearsal' || url.username !== 'postgres' ||
      url.password !== 'rehearsal-only' || url.search || url.hash) {
    throw new Error('Only the disposable loopback PostgreSQL rehearsal target is allowed');
  }
  return url.toString();
}
