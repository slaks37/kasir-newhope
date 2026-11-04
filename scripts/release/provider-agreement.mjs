/** Validate build-time intent without reading or printing credentials. */
export function validateProviderAgreement(env) {
 const frontend=env.VITE_AUTH_PROVIDER||'supabase';
 const backend=env.AUTH_PROVIDER;
 for(const value of [frontend,backend].filter(Boolean))if(!['neon','supabase'].includes(value))throw Error('AUTH_PROVIDER_UNSUPPORTED');
 if(backend&&backend!==frontend)throw Error('AUTH_PROVIDER_BUILD_MISMATCH');
 if(env.NEWHOPE_BUILD_TARGET==='neon'&&frontend!=='neon')throw Error('AUTH_PROVIDER_BUILD_MISMATCH');
 return frontend;
}
