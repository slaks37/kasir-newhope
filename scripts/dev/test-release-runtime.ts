import assert from 'node:assert/strict';import fs from 'node:fs';
import {blogViewTrackingEnabled} from '../../services/shared/blogAnalytics';
import {createReleaseLatencyHandler} from '../../src/server/releaseLatency';
const saved={...process.env},t=JSON.parse(fs.readFileSync('neon/targets/hybrid-staging.json','utf8'));
let opened=0,closed=0;const sql:string[]=[];
const h=createReleaseLatencyHandler(()=>({connect:async()=>{opened++;},query:async(q:string)=>{sql.push(q);return {rows:[]};},end:async()=>{closed++;}} as any));
let code=0,body:any;const res={setHeader(){},status(n:number){code=n;return this;},json(v:any){body=v;return this;}};
try{
 assert.equal(blogViewTrackingEnabled({} as any),true);
 for(const env of [{BLOG_VIEW_TRACKING_ENABLED:'0'},{BLOG_VIEW_TRACKING_ENABLED:'invalid'},{BLOG_VIEW_TRACKING_ENABLED:' '},{BUSINESS_WRITES_PAUSED:'1',BLOG_VIEW_TRACKING_ENABLED:'1'},{NEON_DB_PHASE1:'1',HYBRID_STAGING:'1'}])assert.equal(blogViewTrackingEnabled(env as any),false);
 for(const [v,s,n]of [['production','1','1'],['preview','0','1'],['preview','1','0']]){Object.assign(process.env,{VERCEL_ENV:v,HYBRID_STAGING:s,NEON_DB_PHASE1:n});await h({method:'GET'},res);assert.equal(code,404);}
 assert.equal(opened,0);
 Object.assign(process.env,{VERCEL_ENV:'preview',HYBRID_STAGING:'1',NEON_DB_PHASE1:'1',AUTH_PROVIDER:'supabase',VITE_AUTH_PROVIDER:'supabase',STORAGE_PROVIDER:'supabase',SUPABASE_URL:'https://'+t.sourceProject+'.supabase.co',VITE_SUPABASE_URL:'https://'+t.sourceProject+'.supabase.co',NEON_PROJECT_ID:t.projectId,NEON_BRANCH_ID:t.branchId,DATABASE_URL:'postgresql://newhope_runtime_login:synthetic@'+t.host.replace('.c-3.','-pooler.c-3.')+'/neondb',VERCEL_REGION:'sin1'});
 for(const k of ['HYBRID_RELEASE_TARGET','HYBRID_REHEARSAL_TARGET','BETTER_AUTH_MIGRATION_PILOT','NEON_MIGRATION_PILOT'])delete process.env[k];
 await h({method:'POST'},res);assert.equal(code,405);assert.equal(opened,0);
 await h({method:'GET'},res);assert.equal(code,200);assert.equal(body.region,'sin1');assert.equal(body.queryMs.length,5);assert.deepEqual(sql,['BEGIN READ ONLY',...Array(5).fill('SELECT 1'),'ROLLBACK']);assert.equal(closed,1);assert(!JSON.stringify(body).includes('synthetic'));
 process.env.DATABASE_URL='postgresql://postgres:private@evil.invalid/postgres';await h({method:'GET'},res);assert.equal(code,503);assert.equal(opened,1);assert.equal(JSON.stringify(body).includes('private'),false);
 const p=JSON.parse(fs.readFileSync('package.json','utf8'));assert.equal(p.engines.node,'24.x');assert.equal(fs.readFileSync('.nvmrc','utf8').trim(),'24');
 for(const file of ['ci','security-postgres17','nightly-batch-jobs'])assert.match(fs.readFileSync('.github/workflows/'+file+'.yml','utf8'),/node-version: 24/);
 assert.deepEqual(JSON.parse(fs.readFileSync('vercel.json','utf8')).regions,['sin1']);
 console.log('PASS Preview-only bounded read-only benchmark, production/method/target rejection, no secret errors; Node24 CI/build alignment and Singapore release config');
}finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
