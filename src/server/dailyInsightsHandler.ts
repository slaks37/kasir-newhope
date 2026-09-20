import { timingSafeEqual } from 'node:crypto';
import { connectDb } from '../../services/shared/db';
import { computeDailyBrief,cacheDailyBrief } from '../../services/ai/dailyBrief';

export function createDailyInsightsHandler(connect=()=>connectDb({schema:'ai',max:2})){
  let database:ReturnType<typeof connect>|undefined;
  return async(req:any,res:any)=>{
    const expected=process.env.CRON_SECRET?`Bearer ${process.env.CRON_SECRET}`:'';
    const actual=String(req.headers.authorization||'');
    if(req.method!=='GET')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
    if(!expected||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return res.status(401).json({ok:false,error:'UNAUTHORIZED_CRON'});
    try {
      database??=connect().catch(e=>{database=undefined;throw e;});const db=await database;
      // Oldest cache first: subsequent runs make progress instead of repeatedly
      // serving only the first merchants. Each run is bounded to 25 units.
      const merchants=(await db.query(`SELECT m.id,m.external_ref,t.owner_user_ref FROM internal.merchants m
        JOIN internal.tenants t ON t.id=m.tenant_id LEFT JOIN ai.business_intelligence_cache c ON c.merchant_id=m.id
        WHERE m.external_ref IS NOT NULL AND t.owner_user_ref IS NOT NULL
        ORDER BY c.generated_at ASC NULLS FIRST,m.id LIMIT 25`)).rows;
      let written=0,skipped=0,failed=0;
      for(const m of merchants){try{const document=await computeDailyBrief(db,{subject:m.owner_user_ref},m.external_ref);await cacheDailyBrief(db,document);written++;}
        catch(e){
          const skip=['AI_DISABLED_ON_FREE','TENANT_SUSPENDED','SUBSCRIPTION_EXPIRED','SUBSCRIPTION_REQUIRED'].includes((e as Error).message);
          if(skip)skipped++;else failed++;
          // Record a bounded attempt, never fake zero-valued insights. Otherwise
          // the first 25 ineligible businesses would starve every later tenant.
          await db.query(`INSERT INTO ai.business_intelligence_cache(merchant_id,algorithm_version,generated_at,document)
            VALUES($1,'unavailable',now(),$2::jsonb) ON CONFLICT(merchant_id) DO UPDATE
            SET algorithm_version=EXCLUDED.algorithm_version,generated_at=EXCLUDED.generated_at,document=EXCLUDED.document`,
            [m.id,JSON.stringify({status:skip?'SKIPPED':'UNAVAILABLE'})]);
        }}
      return res.status(failed?503:200).json({ok:failed===0,job:'daily-insights',processed:merchants.length,written,skipped,failed,scope:'up to 25 businesses per run'});
    } catch{return res.status(503).json({ok:false,error:'DAILY_INSIGHTS_UNAVAILABLE'});}
  };
}
export default createDailyInsightsHandler();
