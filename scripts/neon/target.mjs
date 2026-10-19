import fs from 'node:fs';
import {parse} from 'dotenv';

// Never fall back to DATABASE_URL, the default branch, or another Neon project.
export const projectId='steep-sea-66546931';
export const branchId='br-morning-darkness-azwfti4c';
export function stagingTarget(file='.env.neon-staging.local') {
  const env=parse(fs.readFileSync(file));
  if(env.NEON_PROJECT_ID!==projectId || env.NEON_BRANCH_ID!==branchId)throw Error('STAGING_BRANCH_MISMATCH');
  const url=new URL(env.NEON_STAGING_DATABASE_URL||'');
  if(url.hostname!==env.NEON_STAGING_HOST || url.hostname.replace('-pooler','')!=='ep-flat-recipe-azti3hh0.c-3.ap-southeast-1.aws.neon.tech' ||
    url.pathname!=='/neondb' || url.protocol!=='postgresql:')throw Error('STAGING_ENDPOINT_MISMATCH');
  // Migrations bypass the transaction pooler. No credential printed.
  url.hostname=url.hostname.replace('-pooler','');
  for(const key of ['sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat'])url.searchParams.delete(key);
  return {env,connectionString:url.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000};
}
