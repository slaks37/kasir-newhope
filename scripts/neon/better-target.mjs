import fs from 'node:fs';
import {parse} from 'dotenv';
import restore from '../../neon/targets/full-restore.json' with {type:'json'};
import fresh from '../../neon/targets/fresh-candidate.json' with {type:'json'};

// Never fall back to DATABASE_URL, the default branch, or another Neon project.
export const projectId='steep-sea-66546931';
const selectedFile=process.env.NEON_STAGING_ENV_FILE||'.env.better-auth-staging.local';
const selectedIdentity=fs.existsSync(selectedFile)?parse(fs.readFileSync(selectedFile)):{};
export const branchId=selectedIdentity.NEON_BRANCH_ID||'br-icy-dust-azqi5vlc';
const targets=[{projectId,branchId:'br-icy-dust-azqi5vlc',host:'ep-damp-pine-azrnsoge.c-3.ap-southeast-1.aws.neon.tech',database:'neondb'},restore,fresh];
export function stagingTarget(file=selectedFile) {
  const env=parse(fs.readFileSync(file));
  const target=targets.find(t=>t.projectId===env.NEON_PROJECT_ID&&t.branchId===env.NEON_BRANCH_ID);
  if(!target||target.branchId!==branchId)throw Error('STAGING_BRANCH_MISMATCH');
  const url=new URL(env.NEON_STAGING_DATABASE_URL||env.NEON_RESTORE_DATABASE_URL||'');
  const expectedHost=env.NEON_STAGING_HOST||env.NEON_RESTORE_HOST;
  if(url.hostname!==expectedHost&&url.hostname.replace('-pooler','')!==expectedHost)throw Error('STAGING_ENDPOINT_MISMATCH');
  if(url.hostname.replace('-pooler','')!==target.host||url.pathname!=='/'+target.database||url.protocol!=='postgresql:'||
    url.hash||(url.port&&url.port!=='5432')||[...url.searchParams.keys()].some(k=>!['sslmode','channel_binding','application_name'].includes(k)))throw Error('STAGING_ENDPOINT_MISMATCH');
  // Migrations bypass the transaction pooler. No credential printed.
  url.hostname=url.hostname.replace('-pooler','');
  for(const key of ['sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat'])url.searchParams.delete(key);
  return {env,connectionString:url.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000};
}
