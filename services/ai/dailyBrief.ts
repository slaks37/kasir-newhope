import type { Db } from '../shared/db';
import type { AuthPrincipal } from '../shared/auth';
import { loadMerchantSnapshot } from './snapshotData';
import { buildBusinessBrain, BRAIN_VERSION } from '../../src/lib/assistant/businessBrain';
import { runDailyBatch } from '../../src/lib/assistant/insights';
import { assertAiAvailable } from './entitlement';

/** Authenticated principal is rechecked by the loader; only derived, bounded
 * summaries are returned/cached. Raw transactions never leave the adapter. */
export async function computeDailyBrief(db:Db,principal:AuthPrincipal,businessId:string,now=new Date()){
  const identity=(await db.query(`SELECT m.id,m.tenant_id FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id WHERE m.external_ref=$1 AND t.owner_user_ref=$2`,[businessId,principal.subject])).rows[0];
  if(!identity)throw new Error('BUSINESS_NOT_OWNED');
  await assertAiAvailable(db,identity.tenant_id);
  const snapshot=await loadMerchantSnapshot(db,principal,businessId,now);
  const brain=buildBusinessBrain(snapshot,'DATABASE');
  const batch=runDailyBatch(snapshot,{now});
  return {version:BRAIN_VERSION,businessId,merchantId:identity.id,generatedAt:now.toISOString(),sales:brain.sales,
    insights:batch.insights.filter(i=>!['CRM_CHURN','LAYOUT_UTILISATION','STAFF_BEHAVIOUR','SHIFT_PERFORMANCE'].includes(i.category)),
    limitations:['Data pusat: transaksi dan katalog yang sudah disinkronkan. Data pelanggan, resep, stok bahan dan shift belum tersedia di adapter pusat; gunakan panel perangkat untuk domain tersebut.']};
}
export async function cacheDailyBrief(db:Db,document:Awaited<ReturnType<typeof computeDailyBrief>>) {
  await db.query(`INSERT INTO ai.business_intelligence_cache(merchant_id,algorithm_version,generated_at,document)
    VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(merchant_id) DO UPDATE SET algorithm_version=EXCLUDED.algorithm_version,generated_at=EXCLUDED.generated_at,document=EXCLUDED.document`,
    [document.merchantId,document.version,document.generatedAt,JSON.stringify(document)]);
}
