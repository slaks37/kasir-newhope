/** Versioned clean targets. No caller/env string can approve a foreign endpoint. */
export const fullNeonTargets={
 production:{branchId:'br-falling-butterfly-az989m86',host:'ep-twilight-moon-azqj69l8.c-3.ap-southeast-1.aws.neon.tech',database:'neondb',authUrl:'https://ep-twilight-moon-azqj69l8.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth',publicBucket:'blog-media',privateBucket:'business-files'},
 staging:{branchId:'br-morning-darkness-azwfti4c',host:'ep-flat-recipe-azti3hh0.c-3.ap-southeast-1.aws.neon.tech',database:'newhope_full_neon_staging',authUrl:'https://ep-flat-recipe-azti3hh0.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth',publicBucket:'full-neon-public-media',privateBucket:'full-neon-business-files'},
} as const;
export function fullNeonConfig(env=process.env){
 const selection=env.FULL_NEON_TARGET;if(selection!=='production'&&selection!=='staging')throw Error('FULL_NEON_TARGET_REQUIRED');
 const target=fullNeonTargets[selection];
 if(['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','GATEWAY_URL'].some(k=>env[k]?.trim()))throw Error('FULL_NEON_LEGACY_RUNTIME_CONFIGURATION_FORBIDDEN');
 if(selection==='production'&&(env.APP_URL!=='https://kasir.newhope.space'||env.NEON_AUTH_EMAIL_READY!=='1'||env.NEON_AUTH_GOOGLE_READY!=='1'||!env.ADMIN_MFA_ENCRYPTION_KEY))throw Error('FULL_NEON_PRODUCTION_AUTH_ACCEPTANCE_REQUIRED');
 if(env.FULL_NEON_CLEAN_START!=='1'||env.AUTH_PROVIDER!=='neon'||env.STORAGE_PROVIDER!=='neon'||env.NEON_PROJECT_ID!=='steep-sea-66546931'||env.NEON_BRANCH_ID!==target.branchId||env.NEON_DB_PHASE1==='1'||env.DOKU_PAYMENTS_ENABLED!=='0')throw Error('FULL_NEON_CONFIGURATION_MISMATCH');
 if(env.NEON_AUTH_BASE_URL!==target.authUrl || env.NEON_AUTH_JWKS_URL && env.NEON_AUTH_JWKS_URL!==target.authUrl+'/.well-known/jwks.json')throw Error('FULL_NEON_AUTH_BRANCH_MISMATCH');
 if(env.VERCEL_ENV==='production'&&selection!=='production')throw Error('FULL_NEON_STAGING_CANNOT_SERVE_PRODUCTION');
 return {...target,issuer:new URL(target.authUrl).origin,jwksUrl:target.authUrl+'/.well-known/jwks.json'};
}
export function assertFullNeonDatabase(connectionString:string,env=process.env){
 const t=fullNeonConfig(env),u=new URL(connectionString);
 if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname.replace('-pooler','')!==t.host||u.pathname!=='/'+t.database||u.username!=='newhope_clean_runtime'||u.hash||u.port&&u.port!=='5432'||[...u.searchParams.keys()].some(k=>!['sslmode','channel_binding','application_name'].includes(k)))throw Error('FULL_NEON_DATABASE_ROLE_OR_ENDPOINT_MISMATCH');
}

/** Emergency deployment keeps Neon identities/data in place and opens no business pool. */
export const fullNeonMaintenance=(env=process.env)=>env.FULL_NEON_CLEAN_START==='1'&&env.FULL_NEON_MAINTENANCE==='1';
