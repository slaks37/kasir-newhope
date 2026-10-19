import {verifiedNeonTarget} from './neonTargets';

export function betterAuthPilotConfig(env=process.env) {
  const production=env.VERCEL_ENV==='production'||
    (env.NODE_ENV==='production'&&env.VERCEL_ENV!=='preview'&&env.APP_ENV!=='staging');
  if(env.BETTER_AUTH_MIGRATION_PILOT!=='1'||(production&&env.NEON_PRODUCTION_CUTOVER_APPROVED!=='1'))throw Error('BETTER_AUTH_PRODUCTION_CUTOVER_BLOCKED');
  const target=verifiedNeonTarget(env);
  // Current children contain retained rehearsal fixtures. Only a separately
  // reviewed clean final-snapshot target may ever be eligible for activation.
  if(production&&!['cutover-approved'].includes(target.purpose))throw Error('BETTER_AUTH_PRODUCTION_CUTOVER_BLOCKED');
  if(!env.DATABASE_URL)throw Error('BETTER_AUTH_APPLICATION_DATABASE_REQUIRED');
  const databaseUrl=env.BETTER_AUTH_DATABASE_URL||env.DATABASE_URL||env.NEON_STAGING_DATABASE_URL||'';
  const database=new URL(databaseUrl),app=new URL(env.BETTER_AUTH_URL||'');
  if(database.hostname.replace('-pooler','')!==target.host)throw Error('BETTER_AUTH_DATABASE_MISMATCH');
  if(database.pathname!=='/neondb'||!['postgres:','postgresql:'].includes(database.protocol))throw Error('BETTER_AUTH_DATABASE_MISMATCH');
  // Auth and every application service must use the same isolated branch.
  // pg URL query overrides must not redirect a validated hostname elsewhere.
  for(const value of [env.DATABASE_URL,env.BETTER_AUTH_DATABASE_URL,env.NEON_STAGING_DATABASE_URL].filter(Boolean)) {
    const u=new URL(value!);
    if(u.hostname.replace('-pooler','')!==database.hostname.replace('-pooler','')||u.pathname!=='/neondb'||
      !['postgres:','postgresql:'].includes(u.protocol)||(u.port&&u.port!=='5432')||u.hash||
      [...u.searchParams.keys()].some(k=>!['sslmode','channel_binding','application_name'].includes(k)))throw Error('BETTER_AUTH_DATABASE_MISMATCH');
  }
  if(app.username||app.password||app.pathname!=='/'||app.search||app.hash)throw Error('INVALID_BETTER_AUTH_ORIGIN');
  if(app.protocol!=='https:' && !(env.NODE_ENV!=='production'&&['127.0.0.1','localhost'].includes(app.hostname)))throw Error('BETTER_AUTH_HTTPS_REQUIRED');
  if(!env.BETTER_AUTH_SECRET||env.BETTER_AUTH_SECRET.length<48)throw Error('BETTER_AUTH_SECRET_REQUIRED');
  const allowedOrigins=[...new Set([app.origin,...(env.BETTER_AUTH_TRUSTED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean)])];
  for(const origin of allowedOrigins){
    const u=new URL(origin);
    if(u.origin!==origin||u.username||u.password||u.protocol!=='https:'&&!(env.NODE_ENV!=='production'&&['127.0.0.1','localhost'].includes(u.hostname)))throw Error('INVALID_BETTER_AUTH_ORIGIN');
  }
  if(production){
    const application=new URL(env.DATABASE_URL);
    if(application.username!=='newhope_runtime_login'||database.username!=='newhope_auth_runtime_login'||
      application.href===database.href)throw Error('BETTER_AUTH_LEAST_PRIVILEGE_REQUIRED');
    if(app.origin!=='https://kasir.newhope.space'||allowedOrigins.length!==2||
      !allowedOrigins.includes('https://admin.newhope.space')||allowedOrigins.some(s=>!['https://kasir.newhope.space','https://admin.newhope.space'].includes(s)))throw Error('BETTER_AUTH_PRODUCTION_ORIGIN_MISMATCH');
    if(env.STORAGE_PROVIDER!=='neon'||env.AUTH_EMAIL_ENABLED!=='1')throw Error('BETTER_AUTH_PRODUCTION_DEPENDENCIES_REQUIRED');
  }
  return {databaseUrl,baseUrl:app.origin,secret:env.BETTER_AUTH_SECRET,allowedOrigins};
}
