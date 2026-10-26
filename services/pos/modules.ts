import type { Express } from 'express';
import type { Db } from '../shared/db';
import { trustedPrincipal } from '../shared/auth';
import { assertTenantWritable, BillingError } from '../billing/engine';
import { freePlanState } from '../billing/freePlan';
import { legacyModuleForSector, moduleManifest } from '../../src/platform/modules/registry';
import { isBusinessModuleId, type ModuleGrant } from '../../src/platform/modules/contracts';
import { hasSchemaFeature } from '../shared/schemaFeatures';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export class ModuleAccessError extends Error {
  constructor(readonly status: number, code: string) { super(code); }
}
export const moduleWorkspacesEnabled = () => process.env.NEW_HOPE_MODULE_WORKSPACES === '1';
export const permissionsForModuleRole = (role: string): string[] => {
  const roles: Record<string, string[]> = {
    OWNER: ['overview','pos','tables','inventory','customers','labor','reports','ai','settings','payment','businesses'],
    ADMIN: ['overview','pos','tables','inventory','customers','labor','reports','ai','settings'],
    MANAGER: ['overview','pos','tables','inventory','customers','labor','reports'],
    CASHIER: ['overview','pos','tables','customers'],
    BARISTA: ['overview','tables'], CHEF: ['overview','tables'],
    WASHER: ['overview','tables'], KAPSTER: ['overview','tables'], STAFF: ['overview','tables'],
  };
  return roles[role] || [];
};
/** Call in one transaction so RLS settings never leak to another pooled request. */
export async function resolveModuleAccess(db: Db, subject: string, businessId: unknown, outletId: unknown) {
  if (typeof businessId !== 'string' || !UUID.test(businessId) || typeof outletId !== 'string' || !UUID.test(outletId))
    throw new ModuleAccessError(400, 'INVALID_MODULE_SCOPE');
  // Browser cashierRole/permission/sector/tenantId fields are deliberately ignored.
  const { rows } = await db.query(`SELECT t.id AS tenant_id,m.business_sector,t.owner_user_ref=$3 AS tenant_owner,
    CASE WHEN t.owner_user_ref=$3 THEN 'OWNER' ELSE membership.role END AS role,
    (SELECT count(*)::int FROM internal.outlets ox WHERE ox.merchant_id=m.id) AS outlet_count
    FROM internal.outlets o JOIN internal.merchants m ON m.id=o.merchant_id AND m.tenant_id=o.tenant_id
    JOIN internal.tenants t ON t.id=m.tenant_id
    LEFT JOIN LATERAL (SELECT ms.role FROM internal.memberships ms JOIN internal.users u ON u.id=ms.user_id
      WHERE u.id::text=$3 AND u.is_active AND ms.is_active AND ms.tenant_id=t.id
      AND (ms.scope_type='TENANT' OR ms.merchant_id=m.id AND
        (ms.scope_type='MERCHANT' OR ms.scope_type='OUTLET' AND ms.outlet_id=o.id))
      ORDER BY CASE ms.role WHEN 'ADMIN' THEN 1 WHEN 'MANAGER' THEN 2 WHEN 'CASHIER' THEN 3 ELSE 4 END LIMIT 1
    ) membership ON true
    WHERE m.id=$1 AND o.id=$2 AND t.is_active AND t.merged_into IS NULL AND m.is_active AND o.is_active
      AND (t.owner_user_ref=$3 AND EXISTS(SELECT 1 FROM internal.users owner_identity WHERE owner_identity.id::text=$3 AND owner_identity.is_active) OR membership.role IS NOT NULL)`, [businessId, outletId, subject]);
  if (rows.length !== 1) throw new ModuleAccessError(403, 'MODULE_SCOPE_FORBIDDEN');
  const scope = rows[0];
  await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)", [scope.tenant_id, businessId]);
  if (!moduleWorkspacesEnabled() || !await hasSchemaFeature(db, 'moduleAssignments'))
    return { enabled: false, businessId, outletId, modules: [] as ModuleGrant[] };
  await assertTenantWritable(db, scope.tenant_id);
  // Existing Free behavior remains on legacy routes; no paid feature is implicitly granted.
  if ((await freePlanState(db, scope.tenant_id)).free) throw new ModuleAccessError(403, 'MODULE_PILOT_REQUIRES_PAID_OR_TRIAL');
  const isolated=await hasSchemaFeature(db,'workspaceIsolation');
  const assignments = await db.query(`SELECT mm.module_id, e.features,e.expires_at,COALESCE((to_jsonb(mm)->>'workspace_version')::int,1) AS workspace_version FROM internal.merchant_modules mm
    JOIN billing.module_entitlements e ON (e.tenant_id,e.merchant_id,e.module_id)=(mm.tenant_id,mm.merchant_id,mm.module_id)
    LEFT JOIN internal.outlet_modules om ON om.tenant_id=mm.tenant_id AND om.merchant_id=mm.merchant_id
      AND om.module_id=mm.module_id AND om.outlet_id=$3
    WHERE mm.tenant_id=$1 AND mm.merchant_id=$2 AND mm.enabled AND COALESCE(om.enabled,true)
      AND e.enabled AND e.expires_at>now() ORDER BY mm.module_id`, [scope.tenant_id, businessId, outletId]);
  const permissions = permissionsForModuleRole(scope.role);
  const modules: ModuleGrant[] = [];
  for (const row of assignments.rows) {
    const manifest = moduleManifest(row.module_id);
    const operationalModule:Record<string,string>={BARISTA:'fnb',CHEF:'fnb',WASHER:'carwash',KAPSTER:'barber'};if(operationalModule[scope.role]&&operationalModule[scope.role]!==row.module_id)continue;
    if(Number(row.workspace_version)===2&&(!isolated||!['retail','barber'].includes(row.module_id)))continue;
    // Until sector adapters and legacy outlet caches are disentangled, fail closed.
    if (!manifest || Number(row.workspace_version)!==2 && (manifest.sector !== scope.business_sector || scope.outlet_count !== 1)) continue;
    modules.push({ id: manifest.id, permissions, features: row.features, tenantOwner: Boolean(scope.tenant_owner), workspaceVersion:Number(row.workspace_version),expiresAt:new Date(row.expires_at).toISOString() });
  }
  return { enabled: true, businessId, outletId, modules };
}
/** Enrolled pilot merchants cannot bypass module entitlements via legacy URLs.
 * Existing unassigned merchants keep their established authorization path.
 * Caller owns a transaction and has already verified the canonical merchant.
 */
export async function authorizeNativeModule(db: Db, subject: string, merchantId: string, outletId: unknown, requirements: readonly (readonly string[])[]) {
  if (!moduleWorkspacesEnabled() || !await hasSchemaFeature(db, 'moduleAssignments')) return;
  const merchant = (await db.query('SELECT tenant_id,business_sector FROM internal.merchants WHERE id=$1', [merchantId])).rows[0];
  if (!merchant) throw new BillingError(403, 'MODULE_SCOPE_FORBIDDEN');
  await db.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)", [merchant.tenant_id, merchantId]);
  const enrolled = await db.query('SELECT module_id FROM internal.merchant_modules WHERE tenant_id=$1 AND merchant_id=$2 AND guard_legacy_apis', [merchant.tenant_id, merchantId]);
  if (!enrolled.rows.length) return;
  const outlets = await db.query('SELECT id FROM internal.outlets WHERE merchant_id=$1', [merchantId]);
  const target = outletId ?? (outlets.rows.length === 1 ? outlets.rows[0].id : null);
  const manifest = legacyModuleForSector(merchant.business_sector);
  try {
    const access = await resolveModuleAccess(db, subject, merchantId, target);
    const grant = manifest && access.modules.find(module => module.id === manifest.id);
    if(grant?.workspaceVersion===2)throw new ModuleAccessError(403,'EXPLICIT_WORKSPACE_REQUIRED');
    if (!access.enabled || !grant || requirements.some(options => !options.some(permission => grant.permissions.includes(permission) && grant.features.includes(permission))))
      throw new ModuleAccessError(403, 'MODULE_COMMAND_FORBIDDEN');
  } catch (error) {
    if (error instanceof ModuleAccessError) throw new BillingError(error.status, error.message);
    throw error;
  }
}
const stateReadPermissions: Readonly<Record<string, readonly string[]>> = {
  store_settings: permissionsForModuleRole('OWNER'), users: permissionsForModuleRole('OWNER'),
  staff_members: ['pos','tables','labor','settings'], products: ['pos','tables','inventory','reports','ai'],
  categories: ['pos','tables','inventory','reports','ai'], tables: ['pos','tables'], customers: ['pos','customers','ai'],
  order_operations: ['pos','tables'], held_orders: ['pos'], inventory_logs: ['inventory'],
  promo_codes: ['pos','inventory'], stock_items: ['inventory','ai'], bundles: ['pos','inventory'],
  attendance_logs: ['labor'], kds_tickets: ['tables'], carwash_queue: ['tables'], bookings: ['tables'],
  commission_rules: ['labor'], payroll_slips: ['labor'], sent_lifecycle_hooks: ['customers','tables','ai'],
};
const stateWritePermissions: Readonly<Record<string, readonly string[]>> = {
  ...stateReadPermissions, store_settings: ['settings'], users: ['settings'], staff_members: ['labor','settings'],
  products: ['inventory'], categories: ['inventory'], tables: ['tables'], customers: ['customers','pos'],
  stock_items: ['inventory'], bundles: ['inventory'], promo_codes: ['inventory'],
};
export const moduleStateRequirements = (kinds: readonly string[] | null, write = false) => {
  const map = write ? stateWritePermissions : stateReadPermissions;
  return (kinds || Object.keys(map)).map(kind => map[kind] || []);
};
export async function authorizeModulePage(db: Db, subject: string, query: Record<string, unknown>) {
  const access = await resolveModuleAccess(db, subject, query.businessId, query.outletId);
  if (!access.enabled || !isBusinessModuleId(query.moduleId)) throw new ModuleAccessError(403, 'MODULE_NOT_ENABLED');
  const manifest = moduleManifest(query.moduleId)!;
  const page = manifest.pages.find(p => p.id === query.page);
  const grant = access.modules.find(m => m.id === manifest.id);
  if (!page || !grant || page.ownerOnly && !grant.tenantOwner || !grant.permissions.includes(page.permission) || !grant.features.includes(page.permission))
    throw new ModuleAccessError(403, 'MODULE_PAGE_FORBIDDEN');
  if(grant.workspaceVersion===2)await db.query("SELECT set_config('app.outlet_id',$1,true),set_config('app.module_id',$2,true)",[access.outletId,manifest.id]);
  return { access, manifest, page };
}
function respondError(res: any, error: unknown) {
  if (error instanceof ModuleAccessError || error instanceof BillingError) return res.status(error.status).json({ ok: false, error: error.message });
  return res.status(503).json({ ok: false, error: 'MODULE_ACCESS_UNAVAILABLE' });
}
export function registerModuleRoutes(app: Express, db: Db) {
  app.get('/api/v1/sync/modules/revenue', async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    try {
      const from = String(req.query.from || ''), to = String(req.query.to || '');
      const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
      if (!validDate(from) || !validDate(to) || to < from || Date.parse(to) - Date.parse(from) > 90 * 86400000)
        throw new ModuleAccessError(400, 'INVALID_REPORT_PERIOD');
      const offset = Number(req.query.offset ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new ModuleAccessError(400, 'INVALID_REPORT_OFFSET');
      const result = await db.tx(async c => {
        const { access, page } = await authorizeModulePage(c, principal.subject, req.query);
        if (!['reports','group-reports'].includes(page.id)) throw new ModuleAccessError(403, 'MODULE_PAGE_FORBIDDEN');
        // Group visibility is deliberately tenant-owner only. No implicit platform scope.
        const owner = await c.query(`SELECT id FROM internal.tenants WHERE id::text=current_setting('app.tenant_id',true)
          AND owner_user_ref=$1 AND is_active AND merged_into IS NULL`, [principal.subject]);
        if (owner.rows.length !== 1) throw new ModuleAccessError(403, 'GROUP_REPORT_OWNER_REQUIRED');
        const groups = await c.query(`WITH grouped AS (
          SELECT r.merchant_id,r.outlet_id,r.business_sector,to_jsonb(r)->>'module_id' AS module_id,count(*)::int AS transactions,
            sum(r.total_amount) AS net_revenue,sum(r.refund_amount) AS refunds,sum(r.cogs_amount) AS cogs
          FROM contract.merchant_revenue r WHERE r.tenant_id=$1
            AND r.created_at>=($2::date::timestamp AT TIME ZONE 'Asia/Jakarta')
            AND r.created_at<(($3::date+1)::timestamp AT TIME ZONE 'Asia/Jakarta')
          GROUP BY r.merchant_id,r.outlet_id,r.business_sector,to_jsonb(r)->>'module_id'
        ) SELECT *,count(*) OVER()::int AS total_groups,sum(net_revenue) OVER() AS total_net_revenue,
          sum(transactions) OVER() AS total_transactions FROM grouped
          ORDER BY merchant_id,outlet_id NULLS FIRST,business_sector,module_id NULLS FIRST LIMIT 50 OFFSET $4`, [owner.rows[0].id, from, to, offset]);
        return { businessId: access.businessId, rows: groups.rows.map(row => ({ ...row, moduleId:row.module_id||null, attribution:row.module_id?'verified_module':'historical_sector' })),
          nextOffset: groups.rows.length === 50 && offset + 50 < groups.rows[0].total_groups ? offset + 50 : null,
          attribution:groups.rows.some(r=>r.module_id)?groups.rows.every(r=>r.module_id)?'verified_module':'mixed':'historical_sector', from, to, timezone: 'Asia/Jakarta' };
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, ...result });
    } catch (error) { return respondError(res, error); }
  });
  app.get('/api/v1/sync/modules/dashboard', async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    try {
      const result = await db.tx(async c => {
        const { access, manifest, page } = await authorizeModulePage(c, principal.subject, req.query);
        if (page.id !== 'dashboard') throw new ModuleAccessError(403, 'MODULE_PAGE_FORBIDDEN');
        const definitions = {
          fnb: { kind: 'kds_tickets', field: 'status' },
          retail: { kind: 'products', field: 'stock' },
          laundry: { kind: 'order_operations', field: 'laundryStage' },
          carwash: { kind: 'carwash_queue', field: 'stage' },
          barber: { kind: 'bookings', field: 'status' },
        };
        const definition = definitions[manifest.id];
        const isolated=access.modules.find(m=>m.id===manifest.id)?.workspaceVersion===2;
        if(isolated&&manifest.id==='retail'){const stock=await c.query(`SELECT CASE WHEN COALESCE(b.stock,0)<=0 THEN 'OUT_OF_STOCK' ELSE 'AVAILABLE' END AS status,count(*)::int count FROM pos.products p LEFT JOIN LATERAL(SELECT sum(current_stock) stock FROM pos.inventory_balances WHERE inventory_item_id=p.inventory_item_id AND outlet_id=$2) b ON true WHERE p.merchant_id=$1 AND p.module_id=$3 AND p.is_available GROUP BY 1 ORDER BY 1`,[access.businessId,access.outletId,manifest.id]);return {buckets:stock.rows,total:stock.rows.reduce((n,r)=>n+r.count,0),generatedAt:new Date().toISOString()};}
        // Aggregate in PostgreSQL, never download a merchant's complete history.
        // Singleton-outlet adapter only; unknown outlet ownership cannot be guessed.
        const rows = await c.query(`SELECT
          CASE WHEN $4='products' THEN CASE WHEN value->>'stock' ~ '^-?[0-9]+([.][0-9]+)?$' THEN CASE
            WHEN (value->>'stock')::numeric<=0 THEN 'OUT_OF_STOCK'
            WHEN (value->>'stock')::numeric<=(CASE WHEN value->>'minStockAlert' ~ '^[0-9]+([.][0-9]+)?$' THEN (value->>'minStockAlert')::numeric END) THEN 'LOW_STOCK'
            ELSE 'AVAILABLE' END ELSE 'UNKNOWN' END
          ELSE COALESCE(NULLIF(value->>$5,''),'UNKNOWN') END AS status,count(*)::int AS count
          FROM (SELECT DISTINCT ON(record_id) record_id,value,deleted
            FROM pos.shared_state_records
            WHERE tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id=$1
              AND scope=ANY($2::text[]) AND kind=$4
            ORDER BY record_id,updated_at DESC,revision DESC,(scope LIKE 'BUSINESS:%') DESC
          ) records WHERE NOT deleted AND COALESCE(value->>'branchId',value->>'outletId',$3)=$3
          GROUP BY 1 ORDER BY 1`, [access.businessId, isolated?[`WORKSPACE:${access.businessId}:${access.outletId}:${manifest.id}`]:[manifest.sector, 'BUSINESS:' + access.businessId], access.outletId, definition.kind, definition.field]);
        return { buckets: rows.rows, total: rows.rows.reduce((sum, row) => sum + row.count, 0), generatedAt: new Date().toISOString() };
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, ...result });
    } catch (error) { return respondError(res, error); }
  });
  app.get('/api/v1/sync/modules/access', async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    try {
      const result = await db.tx(async c => req.query.moduleId !== undefined || req.query.page !== undefined
        ? (await authorizeModulePage(c, principal.subject, req.query)).access
        : resolveModuleAccess(c, principal.subject, req.query.businessId, req.query.outletId));
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, ...result });
    } catch (error) { return respondError(res, error); }
  });
}
