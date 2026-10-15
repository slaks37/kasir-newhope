/** Demo fixtures belong only on the developer's loopback stack. Never infer
 * permission to seed a customer database from a reachable API or loaded .env. */
export function assertLocalSeedTargets(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' || env.VERCEL === '1' || env.VERCEL_ENV)
    throw Error('DEMO_SEED_LOCAL_ONLY');
  const targets = [env.SEED_API_URL || 'http://127.0.0.1:3000',
    env.SUPABASE_URL || `http://127.0.0.1:${env.DEV_AUTH_PORT || 54321}`];
  for (const target of targets) {
    const url = new URL(target);
    if (url.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/')
      throw Error('DEMO_SEED_LOCAL_ONLY');
  }
  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
        !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.search || url.hash)
      throw Error('DEMO_SEED_LOCAL_DATABASE_ONLY');
  }
}
