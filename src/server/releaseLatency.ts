import pg from 'pg';
import { performance } from 'node:perf_hooks';
import { assertHybridDatabase } from '../../services/shared/hybridPhase1';
import { databaseTransport } from '../../services/shared/databaseTls';
export function createReleaseLatencyHandler(factory=(config:any)=>new pg.Client(config)) {
 return async (req:any,res:any) => {
  res.setHeader('Cache-Control','no-store');
  // Never available on production, even if a staging flag is accidentally left.
  if(process.env.VERCEL_ENV!=='preview'||process.env.HYBRID_STAGING!=='1'||process.env.NEON_DB_PHASE1!=='1')return res.status(404).json({ok:false});
  if(req.method!=='GET')return res.status(405).json({ok:false});
  let c:ReturnType<typeof factory>|undefined;
  try{
   const url=process.env.DATABASE_URL||'';assertHybridDatabase(url);
   c=factory({...databaseTransport(url),connectionTimeoutMillis:10000,statement_timeout:2000});
   const at=performance.now();await c.connect();const connectionMs=performance.now()-at;
   await c.query('BEGIN READ ONLY');const samples=[];
   for(let i=0;i<5;i++){const at=performance.now();await c.query('SELECT 1');samples.push(Math.round((performance.now()-at)*100)/100);}
   await c.query('ROLLBACK');
   return res.status(200).json({ok:true,scope:'bounded SELECT 1; no business rows or writes',region:process.env.VERCEL_REGION||'unknown',node:process.versions.node,connectionMs:Math.round(connectionMs),queryMs:samples});
  }catch{return res.status(503).json({ok:false,error:'BENCHMARK_UNAVAILABLE'});}
  finally{if(c)await c.end().catch(()=>{});}
 };
}
export const releaseLatencyHandler=createReleaseLatencyHandler();
