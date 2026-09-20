import type { Db } from '../shared/db';
import type { AuthPrincipal } from '../shared/auth';
import { assertAiAvailable } from './entitlement';
import { addDate, businessDate, dayStart } from '../../src/lib/assistant/periods';

/** Explicit owner Group BI boundary. No client-supplied merchant/outlet IDs. */
export async function ownerOutletIntelligence(db:Db,principal:AuthPrincipal,now=new Date()) {
  if(!principal?.subject||principal.subject==='local-development')throw new Error('AUTHENTICATION_REQUIRED');
  const tenants=(await db.query('SELECT id FROM internal.tenants WHERE owner_user_ref=$1',[principal.subject])).rows;
  const allowed:string[]=[];
  for(const t of tenants){try{await assertAiAvailable(db,t.id);allowed.push(t.id);}catch{/* no analytics for free, expired or suspended tenants */}}
  if(!allowed.length)throw new Error('AI_ENTITLEMENT_REQUIRED');
  const today=businessDate(now),cutoff=new Date(dayStart(addDate(today,-30))).toISOString(),from=new Date(dayStart(addDate(today,-60))).toISOString(),to=new Date(dayStart(today)).toISOString();
  const rows=(await db.query(`SELECT o.id,o.name,m.name AS business_name,
    COALESCE(sum(r.total_amount) FILTER(WHERE r.created_at >= $3),0) AS revenue,
    COALESCE(sum(r.total_amount) FILTER(WHERE r.created_at < $3),0) AS prior
    FROM internal.outlets o JOIN internal.merchants m ON m.id=o.merchant_id
    JOIN internal.tenants t ON t.id=m.tenant_id
    LEFT JOIN contract.merchant_revenue r ON r.outlet_id=o.id AND r.merchant_id=m.id
      AND r.created_at >= $4 AND r.created_at < $5 AND r.payment_status='PAID'
    WHERE t.owner_user_ref=$1 AND t.id=ANY($2::uuid[])
    GROUP BY o.id,o.name,m.name ORDER BY m.name,o.name`,[principal.subject,allowed,cutoff,from,to])).rows;
  return rows.map(r=>({id:r.id,name:r.name,businessName:r.business_name,revenue:Number(r.revenue),growthPct:Number(r.prior)>0?Math.round((Number(r.revenue)/Number(r.prior)-1)*1000)/10:null}));
}
