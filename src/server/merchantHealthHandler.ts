import {randomUUID,timingSafeEqual} from 'node:crypto';
import {connectDb} from '../../services/shared/db';
import {isCronJobEnabled} from '../../services/shared/cron';
import {computeChurnRisk} from '../lib/internal/churn';

/** Current canonical schema and refund/void-aware reporting contract.
 * This operational job never manufactures paid MRR from subscription status. */
export function createMerchantHealthHandler(connect=()=>connectDb({schema:'internal',max:2,
 connectionString:process.env.FULL_NEON_CLEAN_START==='1'?process.env.DATABASE_URL:process.env.ANALYTICS_DATABASE_URL||process.env.DATABASE_URL})){
 let opening:ReturnType<typeof connect>|undefined;
 return async(req:any,res:any)=>{
  const expected=process.env.CRON_SECRET?'Bearer '+process.env.CRON_SECRET:'',actual=String(req.headers.authorization||'');
  if(!expected||Buffer.byteLength(expected)!==Buffer.byteLength(actual)||!timingSafeEqual(Buffer.from(expected),Buffer.from(actual)))return res.status(401).json({ok:false,error:'UNAUTHORIZED_CRON'});
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  if(!isCronJobEnabled('merchant-health'))return res.status(200).json({ok:true,skipped:true,reason:'JOB_DISABLED'});
  const started=Date.now(),runId=randomUUID();
  try{
   opening??=connect().catch(e=>{opening=undefined;throw e;});const db=await opening;
   const outcome=await db.tx(async c=>{
    if(!(await c.query("SELECT pg_try_advisory_xact_lock(hashtext('newhope:merchant-health')) locked")).rows[0].locked)return {skipped:true};
    const merchants=(await c.query(`SELECT m.id,m.tenant_id,s.status,
      r.last_txn_at,r.daily_revenue,r.daily_transactions,r.active_days,r.rev_7d,r.rev_prior,
      (SELECT count(DISTINCT feature_key)::int FROM internal.feature_usage_events f WHERE f.merchant_id=m.id AND f.occurred_at>=CURRENT_DATE-interval '30 days') features
     FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
     LEFT JOIN billing.subscriptions s ON s.tenant_id=t.id
     LEFT JOIN LATERAL(SELECT max(updated_at) updated_at FROM internal.merchant_health_logs h WHERE h.merchant_id=m.id) h ON true
     LEFT JOIN LATERAL(SELECT max(created_at) last_txn_at,
       coalesce(sum(total_amount) FILTER(WHERE created_at>=CURRENT_DATE),0) daily_revenue,
       count(*) FILTER(WHERE created_at>=CURRENT_DATE)::int daily_transactions,
       count(DISTINCT created_at::date) FILTER(WHERE created_at>=CURRENT_DATE-interval '7 days')::int active_days,
       coalesce(sum(total_amount) FILTER(WHERE created_at>=CURRENT_DATE-interval '7 days'),0) rev_7d,
       coalesce(sum(total_amount) FILTER(WHERE created_at<CURRENT_DATE-interval '7 days'),0) rev_prior
       FROM contract.merchant_revenue x WHERE x.merchant_id=m.id AND x.tenant_id=m.tenant_id AND x.created_at>=CURRENT_DATE-interval '30 days') r ON true
     WHERE t.is_active AND t.merged_into IS NULL AND m.is_active ORDER BY h.updated_at ASC NULLS FIRST,m.id LIMIT 100`)).rows;
    for(const m of merchants){
     const days=m.last_txn_at?Math.max(0,Math.min(999,Math.floor((started-new Date(m.last_txn_at).getTime())/86400000))):999;
     const prior=Number(m.rev_prior)/23,trend=prior>0?((Number(m.rev_7d)/7-prior)/prior)*100:0;
     const risk=computeChurnRisk({daysSinceLastTxn:days,activeDaysLast7:m.active_days,revenueTrendPct:trend,subscriptionStatus:m.status,distinctFeatures:m.features,supportTickets:0});
     await c.query(`INSERT INTO internal.merchant_health_logs(id,tenant_id,merchant_id,log_date,daily_revenue,daily_transaction_count,last_activity_at,days_since_last_txn,active_days_last_7,revenue_trend_pct,distinct_features_used,subscription_status,churn_risk_score,churn_risk_reasons)
      VALUES($1,$2,$3,CURRENT_DATE,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
      ON CONFLICT(merchant_id,log_date) DO UPDATE SET daily_revenue=EXCLUDED.daily_revenue,daily_transaction_count=EXCLUDED.daily_transaction_count,
       last_activity_at=EXCLUDED.last_activity_at,days_since_last_txn=EXCLUDED.days_since_last_txn,active_days_last_7=EXCLUDED.active_days_last_7,
       revenue_trend_pct=EXCLUDED.revenue_trend_pct,distinct_features_used=EXCLUDED.distinct_features_used,subscription_status=EXCLUDED.subscription_status,
       churn_risk_score=EXCLUDED.churn_risk_score,churn_risk_reasons=EXCLUDED.churn_risk_reasons,updated_at=clock_timestamp()`,
      [randomUUID(),m.tenant_id,m.id,m.daily_revenue,m.daily_transactions,m.last_txn_at,days,m.active_days,Math.max(-9999,Math.min(9999,trend)),m.features,m.status,risk.score,JSON.stringify(risk.reasons)]);
    }
    await c.query("INSERT INTO ai.batch_job_runs(id,job_name,started_at,finished_at,status,duration_ms,insights_written) VALUES($1,'merchant-health',$2,clock_timestamp(),'SUCCESS',$3,$4)",[runId,new Date(started).toISOString(),Date.now()-started,merchants.length]);
    return {processed:merchants.length};
   });
   if(outcome.skipped)return res.status(200).json({ok:true,skipped:true,reason:'ALREADY_RUNNING'});
   return res.status(200).json({ok:true,job:'merchant-health',runId,merchantsEvaluated:outcome.processed,durationMs:Date.now()-started});
  }catch{
   try{const db=await opening;if(db)await db.query("INSERT INTO ai.batch_job_runs(id,job_name,started_at,finished_at,status,duration_ms,error_text) VALUES($1,'merchant-health',$2,clock_timestamp(),'FAILED',$3,'MERCHANT_HEALTH_FAILED') ON CONFLICT(id) DO NOTHING",[runId,new Date(started).toISOString(),Date.now()-started]);}catch{/* Never fake successful completion or expose SQL/data. */}
   return res.status(503).json({ok:false,error:'MERCHANT_HEALTH_UNAVAILABLE',runId});
  }
 };
}
export default createMerchantHealthHandler();
