import { Pool } from 'pg';
import { authenticateBearer } from '../../services/shared/auth';
import { FREE_PLAN_ID, isFreePlan } from '../../src/config/freePlanPolicy';
import { subscriptionAccess } from '../../src/config/subscriptionPolicy';
import { validateFreeBranchSelection, FreePlanAccessError } from '../../services/billing/freePlan';
import { serializeInvoice } from '../../services/billing/engine';
import { findSaaSPlan, DAY_MS } from '../../src/config/saasPlans';

/** All identity comes from a verified session, never a tenantId supplied by a browser. */
export async function ownedSubscription(req: any, res: any, selectFree = false) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== (selectFree ? 'POST' : 'GET')) return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  const principal = await authenticateBearer(req);
  if (!principal || principal.subject === 'local-development') return res.status(401).json({ok:false,error:'UNAUTHENTICATED'});
  if (!process.env.DATABASE_URL) return res.status(503).json({ok:false,error:'DATABASE_UNAVAILABLE'});
  const pool = new Pool({ connectionString:process.env.DATABASE_URL, ssl:process.env.DATABASE_URL.includes('localhost') ? false : {rejectUnauthorized:false}, connectionTimeoutMillis:5000 });
  let c: import('pg').PoolClient | undefined;
  try {
    c = await pool.connect();
    await c.query('BEGIN');
    const {rows} = await c.query(`SELECT s.*,t.is_active FROM billing.subscriptions s
      JOIN internal.tenants t ON t.id=s.tenant_id WHERE t.owner_user_ref=$1
      ORDER BY t.created_at,t.id LIMIT 1 FOR UPDATE OF s`, [principal.subject]);
    const s=rows[0];
    if (!s) { await c.query('ROLLBACK'); return res.status(404).json({ok:false,error:'SUBSCRIPTION_NOT_FOUND'}); }
    const source = {status:s.status,planId:s.plan_id,currentPeriodEnd:new Date(s.current_period_end).toISOString(),gracePeriodEnd:s.grace_period_end ? new Date(s.grace_period_end).toISOString() : undefined};
    const free = s.is_active && isFreePlan(source);
    if (selectFree) {
      if (!free) { await c.query('ROLLBACK'); return res.status(409).json({ok:false,error:'FREE_PLAN_NOT_ELIGIBLE'}); }
      const selection = await validateFreeBranchSelection(c,principal.subject,req.body);
      await c.query('UPDATE billing.subscriptions SET free_selection=$2::jsonb,updated_at=now() WHERE id=$1',[s.id,JSON.stringify(selection)]);
      s.free_selection=selection;
    }
    const access = subscriptionAccess(source);
    const plan=findSaaSPlan(free?FREE_PLAN_ID:s.plan_id);
    const outletCount=await c.query('SELECT count(*)::int AS used FROM internal.outlets WHERE tenant_id=$1 AND is_active',[s.tenant_id]);
    const invoices=await c.query('SELECT * FROM billing.invoices WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',[s.tenant_id]);
    await c.query('COMMIT');
    return res.status(200).json({ok:true,daysLeft:free?0:access.daysLeft,subscription:{
      id:s.id,tenantId:s.tenant_id,planId:free?FREE_PLAN_ID:s.plan_id,isActive:s.is_active,
      status:!s.is_active?'EXPIRED':free?'FREE':access.status,
      accessMode:!s.is_active?'RESTRICTED':access.accessMode,
      billingCycle:s.billing_cycle,extraOutlets:free?0:s.extra_outlets,
      currentPeriodStart:s.current_period_start,currentPeriodEnd:s.current_period_end,
      gracePeriodEnd:s.grace_period_end,cancelAtPeriodEnd:s.cancel_at_period_end,
      hasUsedTrial:s.has_used_trial,freeSelection:free?s.free_selection:undefined,
    },plan,accessMode:!s.is_active?'RESTRICTED':access.accessMode,
      activeDays:Math.max(0,Math.floor((Date.now()-Date.parse(s.current_period_start))/DAY_MS)),
      totalPeriodDays:Math.max(1,Math.round((Date.parse(s.current_period_end)-Date.parse(s.current_period_start))/DAY_MS)),
      requiresRenewal:!free&&(access.accessMode!=='FULL'||access.daysLeft<=3),renewalDueDate:free?null:s.current_period_end,
      outlets:{used:free?(s.free_selection?1:0):outletCount.rows[0].used,retained:outletCount.rows[0].used,included:plan?.maxOutlets??2,extra:free?0:Number(s.extra_outlets||0),limit:free?1:(plan?.maxOutlets??2)+Number(s.extra_outlets||0)},
      invoices:invoices.rows.map(serializeInvoice),limits:free?{products:10,outlets:1,accounts:1,ai:false}:undefined});
  } catch (error) {
    await c?.query('ROLLBACK').catch(() => {});
    const invalid=error instanceof Error && error.message==='INVALID_FREE_SELECTION';
    if(error instanceof FreePlanAccessError) return res.status(error.message==='BRANCH_NOT_OWNED'?403:409).json({ok:false,error:error.message});
    return res.status(invalid?400:503).json({ok:false,error:invalid?'INVALID_FREE_SELECTION':'SUBSCRIPTION_UNAVAILABLE'});
  } finally { c?.release(); await pool.end(); }
}
export default async function handler(req:any,res:any) { return ownedSubscription(req,res,true); }
