import fs from 'node:fs';

/** pg connection-string SSL options override the explicit ssl object. Strip
 * them for Neon and always verify its public CA and hostname. */
export function databaseTransport(connectionString: string, env = process.env) {
  const url = new URL(connectionString);
  const neon = /(?:^|\.)neon\.(?:tech|build)$/.test(url.hostname);
  if (neon) {
    for (const key of ['sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat']) url.searchParams.delete(key);
    return {connectionString:url.href, ssl:{rejectUnauthorized:true}};
  }
  const local = ['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname);
  if (local || url.searchParams.get('sslmode') === 'disable') return {connectionString,ssl:undefined};
  return {connectionString,ssl:env.PGSSLROOTCERT
    ? {ca:fs.readFileSync(env.PGSSLROOTCERT,'utf8'),rejectUnauthorized:true}
    : {rejectUnauthorized:false}};
}
