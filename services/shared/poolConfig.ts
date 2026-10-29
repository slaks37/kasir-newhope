/** Serverless HTTP handlers do not keep session state between transactions.
 * Only switch the mode of an existing Supabase shared-pooler endpoint: never
 * invent a host, change the database role/password, or redirect other providers.
 * SQL uses unnamed pg queries and transaction-local RLS settings.
 */
export function serverlessConnectionString(connectionString: string, vercel = process.env.VERCEL): string {
  if(process.env.NEWHOPE_BUILD_TARGET==='neon')return connectionString;
  if (vercel !== '1') return connectionString;
  try {
    const url = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
        !/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/i.test(url.hostname) ||
        url.port !== '5432') return connectionString;
    url.port = '6543';
    return url.toString();
  } catch {
    return connectionString; // Let pg validate; do not log credential-bearing URLs.
  }
}

export function databasePoolLimits(max: number, vercel = process.env.VERCEL) {
  return {
    // Each warm function owns a pool; keep the per-instance budget small.
    max: vercel === '1' ? Math.min(Math.max(1, max), 2) : max,
    idleTimeoutMillis: vercel === '1' ? 5_000 : 30_000,
    connectionTimeoutMillis: 10_000,
  };
}

/**
 * Batas waktu satu statement. Harus lebih pendek dari timeout proxy gateway
 * (10 dtk) agar query yang ditinggalkan klien benar-benar dibatalkan, bukan
 * terus berjalan dan menumpuk sampai seluruh service 503.
 */
export function statementTimeoutMs(raw = process.env.DB_STATEMENT_TIMEOUT_MS): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1_000 && value <= 120_000 ? value : 8_000;
}
