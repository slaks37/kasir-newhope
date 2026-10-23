import {assertFullNeonDatabase} from './fullNeon';
import stagingTarget from '../../neon/targets/hybrid-staging.json';
import prelaunchTarget from '../../neon/targets/prelaunch-rehearsal.json';
import candidateTarget from '../../neon/targets/hybrid-candidate.json';
/** Explicit database-only mode. No identity translation or native-auth fallback. */
export function hybridPhase1Config(env=process.env){
 if(env.HYBRID_REHEARSAL_TARGET&&env.HYBRID_REHEARSAL_TARGET!=='prelaunch-rehearsal')throw Error('HYBRID_REHEARSAL_TARGET_INVALID');
 if(env.HYBRID_REHEARSAL_TARGET&&env.HYBRID_STAGING!=='1')throw Error('HYBRID_REHEARSAL_STAGING_REQUIRED');
 if(env.HYBRID_RELEASE_TARGET&&env.HYBRID_RELEASE_TARGET!=='hybrid-candidate')throw Error('HYBRID_RELEASE_TARGET_INVALID');
 if(env.HYBRID_RELEASE_TARGET&&env.HYBRID_REHEARSAL_TARGET)throw Error('HYBRID_TARGET_FLAGS_CONFLICT');
 const target=env.HYBRID_RELEASE_TARGET==='hybrid-candidate'?candidateTarget:env.HYBRID_REHEARSAL_TARGET==='prelaunch-rehearsal'?prelaunchTarget:stagingTarget;
 if(env.HYBRID_RELEASE_TARGET&&!target.productionEligible)throw Error('HYBRID_RELEASE_TARGET_NOT_APPROVED');
 if(env.NEON_DB_PHASE1!=='1')throw Error('HYBRID_EXPLICIT_MODE_REQUIRED');
 if(env.AUTH_PROVIDER!=='supabase'||env.STORAGE_PROVIDER!=='supabase'||env.VITE_AUTH_PROVIDER!=='supabase'||env.BETTER_AUTH_MIGRATION_PILOT==='1'||env.NEON_MIGRATION_PILOT==='1')throw Error('HYBRID_PROVIDER_MISMATCH');
 const source='https://'+target.sourceProject+'.supabase.co';
 if(env.SUPABASE_URL!==source||env.VITE_SUPABASE_URL!==source)throw Error('HYBRID_SOURCE_AUTH_MISMATCH');
 if(env.NEON_PROJECT_ID!==target.projectId||env.NEON_BRANCH_ID!==target.branchId)throw Error('HYBRID_BRANCH_MISMATCH');
 // A staging child can never be promoted by an environment flag. Candidate
 // eligibility is versioned separately and remains false until owner approval.
 if((env.VERCEL_ENV==='production'||env.NODE_ENV==='production'&&env.VERCEL_ENV!=='preview'&&env.APP_ENV!=='staging')&&!target.productionEligible)throw Error('HYBRID_PRODUCTION_TARGET_NOT_APPROVED');
 return {target,source,staging:env.HYBRID_STAGING==='1'};
}
export function assertHybridDatabase(connectionString:string,env=process.env){
 if(env.FULL_NEON_CLEAN_START==='1'){assertFullNeonDatabase(connectionString,env);return;}
 const url=new URL(connectionString),neon=/(?:^|\.)neon\.(?:tech|build)$/.test(url.hostname);
 if(env.NEON_DB_PHASE1!=='1'){
  if(neon&&(!env.AUTH_PROVIDER||env.AUTH_PROVIDER==='supabase')&&(env.VERCEL==='1'||env.VERCEL_ENV==='production'))throw Error('HYBRID_EXPLICIT_MODE_REQUIRED');
  return;
 }
 const {target}=hybridPhase1Config(env);
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname.replace('-pooler','')!==target.host||url.pathname!=='/'+target.database||decodeURIComponent(url.username)!=='newhope_runtime_login'||url.hash||url.port&&url.port!=='5432'||[...url.searchParams.keys()].some(k=>!['sslmode','channel_binding','application_name'].includes(k)))throw Error('HYBRID_DATABASE_ROLE_OR_ENDPOINT_MISMATCH');
}
export const hybridExternalWritesBlocked=(env=process.env)=>env.NEON_DB_PHASE1==='1'&&env.HYBRID_STAGING==='1';
