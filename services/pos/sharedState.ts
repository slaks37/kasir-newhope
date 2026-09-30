import type { Express } from 'express';
import type { Db } from '../shared/db';
import { trustedPrincipal, tenantForPrincipal } from '../shared/auth';
import { assertTenantWritable, BillingError } from '../billing/engine';
import { assertFreeScope, freePlanState, FreePlanAccessError } from '../billing/freePlan';
import { writeActivity, SECTORS } from './activity';

const SECTOR_SET = new Set<string>(SECTORS);
const GLOBAL_KINDS = new Set(['users', 'staff_members']);
const SECTOR_KINDS = new Set([
  'categories', 'products', 'tables', 'customers', 'orders', 'held_orders', 'inventory_logs',
  'cash_movements', 'shift', 'shift_history', 'promo_codes', 'stock_items',
  'bundles', 'attendance_logs', 'kds_tickets', 'carwash_queue', 'bookings',
  'commission_rules', 'payroll_slips', 'sent_lifecycle_hooks', 'store_settings',
]);
const ID_RE = /^[^\x00-\x1f\x7f]{1,128}$/;

class StateConflict extends Error {
  constructor(readonly kind: string, readonly recordId: string) { super('STATE_CONFLICT'); }
}

type Operation = { kind: string; recordId: string; baseRevision: number; value: unknown; deleted: boolean };

function validOperations(value: unknown): Operation[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null;
  const seen = new Set<string>();
  const operations: Operation[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.kind !== 'string' || !(GLOBAL_KINDS.has(r.kind) || SECTOR_KINDS.has(r.kind)) ||
      typeof r.recordId !== 'string' || !ID_RE.test(r.recordId) ||
      !Number.isSafeInteger(r.baseRevision) || Number(r.baseRevision) < 0 ||
      typeof r.deleted !== 'boolean') return null;
    const key = `${r.kind}\x00${r.recordId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    if (!r.deleted && (!r.value || typeof r.value !== 'object' || Array.isArray(r.value))) return null;
    if (r.kind === 'users' && !r.deleted) {
      const user = r.value as Record<string, unknown>;
      if (user.id !== r.recordId || !['MANAGER','CASHIER'].includes(String(user.role)) ||
        !['ACTIVE','INACTIVE'].includes(String(user.status)) ||
        typeof user.pin !== 'string' || !/^sha256\$[^$]{8,128}\$[a-f0-9]{64}$/i.test(user.pin)) return null;
    }
    if (r.kind === 'products' && !r.deleted) {
      const product=r.value as Record<string,unknown>;
      if(product.id!==r.recordId || typeof product.name!=='string' || !product.name.trim() ||
        product.name.length>100 || !Number.isFinite(product.price) || Number(product.price)<0 ||
        !Number.isFinite(product.costPrice) || Number(product.costPrice)<0) return null;
    }
    if (r.kind === 'store_settings' && !r.deleted) {
      const settings = r.value as Record<string, unknown>;
      if ('subscription' in settings || 'branches' in settings || 'activeBranchId' in settings ||
        'logoUrl' in settings || 'registeredTerminalId' in settings) return null;
    }
    if (r.deleted && r.value !== null) return null;
    if (JSON.stringify(r.value).length > 64000) return null;
    operations.push({ kind:r.kind,recordId:r.recordId,baseRevision:Number(r.baseRevision),value:r.value,deleted:r.deleted });
  }
  return operations;
}

async function scopeFor(db: Db, subject: string, sector: string) {
  const tenantId = await tenantForPrincipal(db,{subject});
  if (!tenantId) return null;
  const {rows} = await db.query(`SELECT m.id AS merchant_id, t.is_active
    FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
    WHERE t.id=$1 AND t.owner_user_ref=$2 AND m.business_sector=$3
    ORDER BY (m.external_ref=$4) DESC NULLS LAST, m.created_at, m.id LIMIT 1`,
    [tenantId,subject,sector,`${subject}_${sector}`]);
  if (!rows.length || !rows[0].is_active) return null;
  return {tenantId,merchantId:rows[0].merchant_id as string};
}

export function registerSharedStateRoutes(app: Express, db: Db) {
  app.get('/api/v1/sync/state', async (req,res) => {
    const principal=trustedPrincipal(req);
    if(!principal) return res.status(401).json({ok:false,error:'UNAUTHENTICATED'});
    const sector=String(req.query.sector||'');
    if(!SECTOR_SET.has(sector)) return res.status(400).json({ok:false,error:'INVALID_SECTOR'});
    try {
      const scope=await scopeFor(db,principal.subject,sector);
      if(!scope) return res.json({ok:true,ready:false,records:[]});
      const {rows}=await db.tx(async c=>{
        await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)",
          [scope.tenantId,scope.merchantId]);
        return c.query(`SELECT scope,kind,record_id,value,revision,deleted,updated_at
          FROM pos.shared_state_records WHERE tenant_id=$1 AND
          ((scope='GLOBAL' AND merchant_id IS NULL) OR (scope=$2 AND merchant_id=$3))
          ORDER BY scope,kind,record_id LIMIT 10000`,[scope.tenantId,sector,scope.merchantId]);
      });
      return res.json({ok:true,ready:true,records:rows.map((r:any)=>({scope:r.scope,kind:r.kind,
        recordId:r.record_id,value:r.value,revision:Number(r.revision),deleted:r.deleted,updatedAt:r.updated_at}))});
    } catch { return res.status(503).json({ok:false,error:'STATE_UNAVAILABLE'}); }
  });

  app.post('/api/v1/sync/state', async (req,res) => {
    const principal=trustedPrincipal(req);
    if(!principal) return res.status(401).json({ok:false,error:'UNAUTHENTICATED'});
    const sector=String(req.body?.sector||'');
    const requestedOutletId=typeof req.body?.outletId==='string' && /^[0-9a-f-]{36}$/i.test(req.body.outletId)
      ? req.body.outletId:null;
    const operations=validOperations(req.body?.operations);
    if(!SECTOR_SET.has(sector) || !operations) return res.status(400).json({ok:false,error:'INVALID_STATE_REQUEST'});
    try {
      const scope=await scopeFor(db,principal.subject,sector);
      if(!scope) return res.status(409).json({ok:false,error:'BUSINESS_SETUP_REQUIRED'});
      const versions=await db.tx(async c=>{
        await c.query('SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE',[scope.tenantId]);
        await assertTenantWritable(c,scope.tenantId);
        await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)",
          [scope.tenantId,scope.merchantId]);
        const free=await freePlanState(c,scope.tenantId);
        assertFreeScope(free,sector,[]);
        if (free.free && operations.some(op=>op.kind==='users' || op.kind==='staff_members'))
          throw new FreePlanAccessError('FREE_OWNER_ONLY');
        const result: Array<{kind:string;recordId:string;revision:number}> = [];
        let productOutlet:string|null=null;
        if(operations.some(op=>op.kind==='products')){
          const outlet=await c.query(`SELECT id FROM internal.outlets WHERE tenant_id=$1 AND merchant_id=$2
            AND is_active AND ($3::uuid IS NULL OR id=$3::uuid) ORDER BY created_at,id LIMIT 1`,
            [scope.tenantId,scope.merchantId,requestedOutletId]);
          if(!outlet.rows.length)throw new BillingError(409,'OUTLET_SETUP_REQUIRED');
          productOutlet=outlet.rows[0].id;
        }
        for(const op of operations){
          if(op.kind==='products' && !op.deleted)assertFreeScope(free,sector,[op.recordId]);
          const docScope=GLOBAL_KINDS.has(op.kind)?'GLOBAL':sector;
          const merchantId=docScope==='GLOBAL'?null:scope.merchantId;
          const r=await c.query(`INSERT INTO pos.shared_state_records
            (tenant_id,merchant_id,scope,kind,record_id,value,revision,deleted)
            VALUES($1,$2,$3,$4,$5,$6::jsonb,1,$7)
            ON CONFLICT(tenant_id,scope,kind,record_id) DO UPDATE SET
              value=EXCLUDED.value,deleted=EXCLUDED.deleted,
              revision=pos.shared_state_records.revision+1,updated_at=now()
            WHERE pos.shared_state_records.revision=$8
              AND pos.shared_state_records.merchant_id IS NOT DISTINCT FROM EXCLUDED.merchant_id
            RETURNING revision`,[scope.tenantId,merchantId,docScope,op.kind,op.recordId,
              op.deleted?null:JSON.stringify(op.value),op.deleted,op.baseRevision]);
          if(!r.rows.length || (op.baseRevision!==0 && Number(r.rows[0].revision)===1))
            throw new StateConflict(op.kind,op.recordId);
          if(op.kind==='products'){
            if(op.deleted){
              await c.query(`UPDATE pos.products SET is_available=false,catalog_synced_at=now()
                WHERE tenant_id=$1 AND merchant_id=$2 AND external_ref=$3`,
                [scope.tenantId,scope.merchantId,op.recordId]);
            } else {
              const p=op.value as Record<string,unknown>;
              const saved=await c.query(`INSERT INTO pos.products
                (id,tenant_id,merchant_id,outlet_id,name,sku,price,cost_price,is_available,
                 business_sector,business_id,category_name,description,unit,external_ref,catalog_synced_at)
                VALUES(uuidv7(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
                ON CONFLICT(tenant_id,external_ref) WHERE external_ref IS NOT NULL DO UPDATE SET
                  name=EXCLUDED.name,sku=EXCLUDED.sku,price=EXCLUDED.price,
                  cost_price=EXCLUDED.cost_price,is_available=EXCLUDED.is_available,
                  category_name=EXCLUDED.category_name,description=EXCLUDED.description,
                  unit=EXCLUDED.unit,catalog_synced_at=now()
                WHERE pos.products.merchant_id=EXCLUDED.merchant_id RETURNING id`,
                [scope.tenantId,scope.merchantId,productOutlet,String(p.name).trim(),
                  String(p.sku||op.recordId).slice(0,50),Number(p.price),Number(p.costPrice),
                  p.isAvailable!==false,sector,`${principal.subject}_${sector}`,
                  String(p.categoryName||'Lainnya').slice(0,100),String(p.description||'').slice(0,300),
                  String(p.unit||'pcs').slice(0,20),op.recordId]);
              if(!saved.rows.length)throw new StateConflict(op.kind,op.recordId);
            }
          }
          result.push({kind:op.kind,recordId:op.recordId,revision:Number(r.rows[0].revision)});
        }
        const kinds=[...new Set(operations.map(op=>op.kind))];
        await writeActivity(c,{merchantId:scope.merchantId,tenantId:scope.tenantId,
          businessSector:sector,businessId:`${principal.subject}_${sector}`,appModule:'SYNC',
          eventType:'SHARED_STATE_CHANGED',actorUserId:principal.subject,
          actorName:principal.email||null,summary:`${operations.length} perubahan data operasional`,
          detail:{kinds,records:operations.map(op=>({kind:op.kind,id:op.recordId,deleted:op.deleted}))}});
        return result;
      });
      return res.json({ok:true,versions});
    } catch(error) {
      if(error instanceof StateConflict) return res.status(409).json({ok:false,error:'STATE_CONFLICT',kind:error.kind,recordId:error.recordId});
      if(error instanceof FreePlanAccessError) return res.status(403).json({ok:false,error:error.message});
      if(error instanceof BillingError) return res.status(error.status).json({ok:false,error:error.message});
      return res.status(503).json({ok:false,error:'STATE_UNAVAILABLE'});
    }
  });
}
