/** Validate build-time intent without reading or printing credentials. */
export function validateProviderAgreement(env) {
 const frontend=env.VITE_AUTH_PROVIDER||'supabase';
 const backend=env.AUTH_PROVIDER;
 // Existing production has stale provider selectors that main never consumed.
 // A draft alternative must fail at build time rather than replace live login.
 if(env.VERCEL_ENV==='production'&&(frontend==='neon'||backend==='neon'))throw Error('AUTH_PRODUCTION_CUTOVER_DISABLED');
 for(const value of [frontend,backend].filter(Boolean))if(!['neon','supabase'].includes(value))throw Error('AUTH_PROVIDER_UNSUPPORTED');
 if(backend&&backend!==frontend)throw Error('AUTH_PROVIDER_BUILD_MISMATCH');
 if(env.NEWHOPE_BUILD_TARGET==='neon'&&frontend!=='neon')throw Error('AUTH_PROVIDER_BUILD_MISMATCH');
 return frontend;
}
