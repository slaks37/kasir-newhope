/** This branch is a migration experiment, not a production auth cutover. */
export function neonPilotConfig(env = process.env) {
  if (env.NEON_MIGRATION_PILOT !== '1' || env.VERCEL_ENV === 'production' ||
    (env.NODE_ENV === 'production' && env.VERCEL_ENV !== 'preview' && env.APP_ENV !== 'staging'))
    throw new Error('NEON_PILOT_PRODUCTION_CUTOVER_BLOCKED');
  const base = new URL(env.NEON_AUTH_BASE_URL || '');
  if (base.protocol !== 'https:' || !/(?:^|\.)neon\.(?:tech|build)$/.test(base.hostname) || base.username || base.password)
    throw new Error('INVALID_NEON_AUTH_CONFIGURATION');
  const authUrl=base.href.replace(/\/$/,'');
  const jwksUrl=authUrl+'/.well-known/jwks.json';
  if (env.NEON_AUTH_JWKS_URL && env.NEON_AUTH_JWKS_URL !== jwksUrl) throw new Error('NEON_JWKS_BRANCH_MISMATCH');
  return {authUrl,jwksUrl,issuer:base.origin};
}
