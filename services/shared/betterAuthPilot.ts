export function betterAuthPilotConfig(env=process.env) {
  if(env.BETTER_AUTH_MIGRATION_PILOT!=='1'||env.VERCEL_ENV==='production'||
    (env.NODE_ENV==='production'&&env.VERCEL_ENV!=='preview'&&env.APP_ENV!=='staging'))throw Error('BETTER_AUTH_PRODUCTION_CUTOVER_BLOCKED');
  if(env.NEON_PROJECT_ID!=='steep-sea-66546931'||env.NEON_BRANCH_ID!=='br-icy-dust-azqi5vlc')throw Error('BETTER_AUTH_STAGING_BRANCH_MISMATCH');
  if(!env.DATABASE_URL)throw Error('BETTER_AUTH_APPLICATION_DATABASE_REQUIRED');
  const databaseUrl=env.BETTER_AUTH_DATABASE_URL||env.DATABASE_URL||env.NEON_STAGING_DATABASE_URL||'';
  const database=new URL(databaseUrl),app=new URL(env.BETTER_AUTH_URL||'');
  if(database.hostname.replace('-pooler','')!=='ep-damp-pine-azrnsoge.c-3.ap-southeast-1.aws.neon.tech')throw Error('BETTER_AUTH_DATABASE_MISMATCH');
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
  return {databaseUrl,baseUrl:app.origin,secret:env.BETTER_AUTH_SECRET};
}
