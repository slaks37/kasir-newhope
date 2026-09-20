import type { Db } from '../shared/db';
import { assertTenantWritable, BillingError } from '../billing/engine';
import { freePlanState } from '../billing/freePlan';
import { isFreePlan } from '../../src/config/freePlanPolicy';
import { TRIAL_DAYS, DAY_MS } from '../../src/config/saasPlans';

export async function assertAiAvailable(db: Pick<Db,'query'>, tenantId: string) {
  if ((await freePlanState(db,tenantId)).free) throw new BillingError(403,'AI_DISABLED_ON_FREE');
  // Legacy accounts without a subscription row still expire after 45 days.
  // General POS access allows lifetime Free, but that must not enable AI.
  const row=(await db.query(`SELECT t.created_at,s.status,s.plan_id,s.current_period_end
    FROM internal.tenants t LEFT JOIN contract.subscription_operations s ON s.tenant_id=t.id WHERE t.id=$1`,[tenantId])).rows[0];
  if (!row) throw new BillingError(403,'TENANT_NOT_FOUND');
  if (isFreePlan({status:row.status||'TRIAL',planId:row.plan_id,
    currentPeriodEnd:new Date(row.current_period_end || Date.parse(row.created_at)+TRIAL_DAYS*DAY_MS).toISOString()}))
    throw new BillingError(403,'AI_DISABLED_ON_FREE');
  await assertTenantWritable(db,tenantId);
}
