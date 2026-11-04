export function authProvider(env=process.env):'supabase'|'neon'{
 if(process.env.NEWHOPE_BUILD_TARGET==='neon'){
  if(env.AUTH_PROVIDER&&env.AUTH_PROVIDER!=='neon')throw Error('AUTH_PROVIDER_UNSUPPORTED');
  return 'neon';
 }
 const value=env.AUTH_PROVIDER||'supabase';
 if(value!=='supabase'&&value!=='neon')throw Error('AUTH_PROVIDER_UNSUPPORTED');return value;
}
const local=(host:string)=>['localhost','127.0.0.1','[::1]'].includes(host);
export function getAuthConfig(env=process.env){
 const production=env.VERCEL_ENV==='production'||env.NODE_ENV==='production'&&env.VERCEL_ENV!=='preview'&&env.APP_ENV!=='staging';
 if(production||env.NEWHOPE_NEON_AUTH_STAGING!=='1')throw Error('NEON_AUTH_PRODUCTION_CUTOVER_DISABLED');
 const base=new URL(env.NEWHOPE_AUTH_URL||'');
 if(base.username||base.password||base.pathname!=='/'||base.search||base.hash||base.protocol!=='https:'&&!(env.NODE_ENV!=='production'&&local(base.hostname)))throw Error('AUTH_HTTPS_ORIGIN_REQUIRED');
 const databaseUrl=env.BETTER_AUTH_DATABASE_URL||'',db=new URL(databaseUrl),app=new URL(env.DATABASE_URL||databaseUrl);
 const host=db.hostname.replace('-pooler',''),expected=env.NEWHOPE_AUTH_NEON_HOST;
 const testLocal=env.NODE_ENV==='test'&&local(db.hostname);
 if(!['postgres:','postgresql:'].includes(db.protocol)||db.hash||db.port&&db.port!=='5432'&&!testLocal||[...db.searchParams.keys()].some(k=>!['sslmode','channel_binding','application_name'].includes(k)))throw Error('AUTH_DATABASE_TARGET_REJECTED');
 if(!testLocal&&(!expected||host!==expected||!/^br-/.test(env.NEWHOPE_AUTH_NEON_BRANCH_ID||'')||!host.endsWith('.neon.tech')))throw Error('AUTH_STAGING_BRANCH_REQUIRED');
 if(app.hostname.replace('-pooler','')!==host||app.pathname!==db.pathname)throw Error('AUTH_APPLICATION_BRANCH_MISMATCH');
 if(!env.BETTER_AUTH_SECRET||env.BETTER_AUTH_SECRET.length<48)throw Error('AUTH_SECRET_REQUIRED');
 const allowedOrigins=[...new Set([base.origin,...(env.NEWHOPE_AUTH_TRUSTED_ORIGINS||'').split(',').filter(Boolean)])];
 for(const origin of allowedOrigins){const u=new URL(origin);if(u.origin!==origin||u.protocol!=='https:'&&!(env.NODE_ENV!=='production'&&local(u.hostname)))throw Error('AUTH_ORIGIN_REJECTED');}
 const nativeOrigins=(env.NEW_HOPE_NATIVE_ORIGINS||'').split(',').filter(Boolean);
 if(nativeOrigins.some(o=>!['capacitor://localhost','https://localhost'].includes(o)))throw Error('AUTH_NATIVE_ORIGIN_REJECTED');
 const google=env.NEWHOPE_GOOGLE_CLIENT_ID&&env.NEWHOPE_GOOGLE_CLIENT_SECRET?{clientId:env.NEWHOPE_GOOGLE_CLIENT_ID,clientSecret:env.NEWHOPE_GOOGLE_CLIENT_SECRET}:undefined;
 return {databaseUrl,baseUrl:base.origin,secret:env.BETTER_AUTH_SECRET,allowedOrigins,nativeOrigins,google};
}
/** Strip driver URL SSL overrides, then enforce certificate validation. */
export function authDatabaseOptions(value:string){const u=new URL(value);u.searchParams.delete('sslmode');u.searchParams.delete('channel_binding');return {connectionString:u.href,ssl:local(u.hostname)?false:{rejectUnauthorized:true}};}
