/**
 * Jembatan dari aplikasi kasir (localStorage) ke database.
 *
 * Aplikasi ini offline-first: kasir tetap melayani saat internet mati, dan
 * mengirim antriannya begitu tersambung. Konsekuensi yang menentukan seluruh
 * desain di file ini: PENGIRIMAN YANG SAMA AKAN DATANG BERKALI-KALI. Jaringan
 * putus setelah server menyimpan tapi sebelum jawabannya sampai, pengguna
 * menekan "sinkronkan" dua kali, tab dibuka rangkap — semuanya normal.
 *
 * Karena itu tidak ada satu pun INSERT di sini yang tanpa pengaman:
 *   - tenants / users / products  -> dicocokkan lewat external_ref
 *   - transactions                -> UNIQUE (tenant_id, client_txn_id)
 *   - seluruh batch               -> sync_receipts.idempotency_key
 *
 * Menghitung omzet dua kali adalah kerusakan yang tidak bisa diperbaiki lewat
 * layar mana pun, jadi pertahanannya berlapis dan sengaja berlebihan.
 */

import type express from 'express';
import { randomBytes } from 'node:crypto';
import { assertTenantWritable, BillingError } from '../billing/engine';
import { freePlanState, assertFreeScope, resolveFreeSyncScope, FreePlanAccessError } from '../billing/freePlan';
import type { Db } from '../shared/db';
import { applyTenders } from './tenders';
import { SECTORS, writeActivity, type Sector } from './activity';
import { canAccessBusiness, trustedPrincipal, tenantForPrincipal } from '../shared/auth';
import { registerSharedStateRoutes } from './sharedState';
import { registerReportRoutes } from './reports';
import { registerFinanceRoutes, applyRefund, FinanceError, type RefundCommand } from './finance';

const SECTOR_SET = new Set<string>(SECTORS);
const MAX_BATCH = 500;

class SyncAccessError extends Error {}
class ProductLimitError extends Error {}

async function ensureInventoryLocation(db: Db, tenantId: string, merchantId: string, outletId: string): Promise<string> {
  const existing=await db.query(`SELECT id FROM pos.inventory_locations
    WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND is_primary AND is_active
    ORDER BY created_at,id LIMIT 1`,[tenantId,merchantId,outletId]);
  if(existing.rows.length)return existing.rows[0].id;
  await db.query(`INSERT INTO pos.inventory_locations
    (id,tenant_id,merchant_id,outlet_id,name,is_primary,is_active)
    VALUES(uuidv7(),$1,$2,$3,'Gudang Utama',true,true)
    ON CONFLICT(outlet_id,name) DO NOTHING`,[tenantId,merchantId,outletId]);
  const created=await db.query(`SELECT id FROM pos.inventory_locations
    WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND is_active
    ORDER BY is_primary DESC,created_at,id LIMIT 1`,[tenantId,merchantId,outletId]);
  if(!created.rows.length)throw new BillingError(409,'INVENTORY_LOCATION_REQUIRED');
  return created.rows[0].id;
}

async function assertBusinessCanBeClaimed(db: Db, businessId: string, ownerSubject: string): Promise<void> {
  if (ownerSubject === 'local-development') return;
  const { rows } = await db.query(
    `SELECT t.owner_user_ref
       FROM internal.merchants m
       JOIN internal.tenants t ON t.id = m.tenant_id
      WHERE m.external_ref = $1
      LIMIT 1`,
    [businessId]
  );
  if (rows.length && rows[0].owner_user_ref !== ownerSubject) {
    throw new SyncAccessError('BUSINESS_NOT_OWNED');
  }
}

async function productLimitForTenant(db: Db, tenantId: string): Promise<number> {
  // All three catalog plans allow unlimited products.
  return -1;
}

interface SyncItem {
  clientItemId?: string;
  productRef?: string;
  productName: string;
  productDescription?: string;
  categoryName?: string;
  unitPrice: number;
  unitCost?: number;
  quantity: number;
  totalPrice?: number;
}

interface SyncTxn {
  tenders?: import('./tenders').TenderCommand[];
  refunds?: RefundCommand[];
  clientTxnId: string;
  invoiceNumber?: string;
  cashierRef?: string;
  cashierName?: string;
  cashierRole?: string;
  subtotal: number;
  discountAmount?: number;
  taxAmount?: number;
  serviceChargeAmount?: number;
  totalAmount: number;
  paymentMethod?: string;
  paymentStatus?: string;
  orderType?: string;
  appModule?: string;
  createdAt?: string;
  businessDate?: string;
  completedAt?: string;
  cancelledAt?: string;
  voidedAt?: string;
  shiftId?: string;
  items: SyncItem[];
}

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const outletRef = (value: unknown): string | null => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;

export function registerSyncRoutes(app: express.Express, db: Db): void {
  registerSharedStateRoutes(app,db);
  registerReportRoutes(app,db);
  registerFinanceRoutes(app,db);
  // Explicit owner onboarding; provisioning stays inside the existing POS role.
  // No outlet is opened here: billing separately enforces the active-outlet cap.
  app.post('/api/v1/sync/business', async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal || principal.subject === 'local-development') return res.status(401).json({ok:false,error:'UNAUTHENTICATED'});
    const sector = str(req.body?.sector,16);
    const storeName = str(req.body?.storeName,100);
    if (!sector || !SECTOR_SET.has(sector) || !storeName) return res.status(400).json({ok:false,error:'INVALID_BUSINESS'});
    const businessId = `${principal.subject}_${sector}`;
    try {
      const result = await db.tx(async c => {
        await assertBusinessCanBeClaimed(c,businessId,principal.subject);
        let tenantId = await tenantForPrincipal(c,principal);
        if (!tenantId) {
          const created = await c.query(`INSERT INTO internal.tenants(id,name,external_ref,owner_user_ref)
            VALUES(uuidv7(),$1,$2,$2) ON CONFLICT(external_ref) WHERE external_ref IS NOT NULL
            DO UPDATE SET name=EXCLUDED.name RETURNING id`,[storeName,principal.subject]);
          tenantId = created.rows[0].id;
        }
        if (!tenantId) throw new BillingError(409,'TENANT_NOT_PROVISIONED');
        await c.query('SELECT id FROM internal.tenants WHERE id=$1 FOR UPDATE',[tenantId]);
        await assertTenantWritable(c,tenantId);
        const existing = (await c.query('SELECT id FROM internal.merchants WHERE tenant_id=$1 AND business_sector=$2 ORDER BY created_at LIMIT 1',[tenantId,sector])).rows[0];
        if (existing) return {tenantId,merchantId:existing.id};
        const created = await c.query(`INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref)
          VALUES(uuidv7(),$1,$2,$3,$4) ON CONFLICT(external_ref) WHERE external_ref IS NOT NULL
          DO UPDATE SET name=EXCLUDED.name WHERE internal.merchants.tenant_id=$1 RETURNING id`,[tenantId,storeName,sector,businessId]);
        if (!created.rows.length) throw new BillingError(409,'BUSINESS_OWNERSHIP_CONFLICT');
        return {tenantId,merchantId:created.rows[0].id};
      });
      return res.json({ok:true,...result});
    } catch (error) {
      return res.status(error instanceof BillingError ? error.status : 500).json({ok:false,error:error instanceof BillingError ? error.message : 'BUSINESS_SETUP_FAILED'});
    }
  });
  // A receipt logo belongs to a business unit, never to the browser or owner account.
  // Store only small raster data URLs: no remote image fetches or SVG script content.
  app.get('/api/v1/sync/receipt-logo', async (req, res) => {
    const principal = trustedPrincipal(req);
    const businessId = str(req.query.businessId, 96);
    if (!principal) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    if (!businessId) return res.status(400).json({ ok: false, error: 'BUSINESS_ID_REQUIRED' });
    if (!(await canAccessBusiness(db, principal, businessId))) return res.status(403).json({ ok: false, error: 'BUSINESS_NOT_OWNED' });
    const { rows } = await db.query('SELECT logo_url FROM internal.merchants WHERE external_ref = $1', [businessId]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'BUSINESS_NOT_FOUND' });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, logoUrl: rows[0].logo_url || null });
  });

  app.put('/api/v1/sync/receipt-logo', async (req, res) => {
    const principal = trustedPrincipal(req);
    const businessId = str(req.body?.businessId, 96);
    const logoUrl = req.body?.logoUrl;
    if (!principal) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    if (!businessId) return res.status(400).json({ ok: false, error: 'BUSINESS_ID_REQUIRED' });
    if (!(await canAccessBusiness(db, principal, businessId))) return res.status(403).json({ ok: false, error: 'BUSINESS_NOT_OWNED' });
    if (logoUrl !== null && logoUrl !== undefined) {
      if (typeof logoUrl !== 'string' || logoUrl.length > 200_000) return res.status(413).json({ ok: false, error: 'LOGO_TOO_LARGE' });
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(logoUrl);
      if (!match) return res.status(400).json({ ok: false, error: 'INVALID_LOGO' });
      const bytes = Buffer.from(match[2], 'base64');
      const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : match[1] === 'jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255,216,255]))
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
      if (!valid) return res.status(400).json({ ok: false, error: 'INVALID_LOGO' });
    }
    const { rows } = await db.query(
      'UPDATE internal.merchants SET logo_url = $1, updated_at = now() WHERE external_ref = $2 RETURNING id',
      [logoUrl || null, businessId]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'BUSINESS_NOT_FOUND' });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true });
  });

  /**
   * POST /api/v1/sync/transactions
   *
   * {
   *   idempotencyKey, businessId, sector, storeName, ownerRef,
   *   transactions: [ { clientTxnId, items: [...], ... } ]
   * }
   */
  app.post('/api/v1/sync/transactions', async (req, res) => {
    const body = req.body ?? {};
    const businessId = str(body.businessId, 96);
    const sector = str(body.sector, 16);
    const storeName = str(body.storeName, 100) ?? 'Tanpa Nama';
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    // ownerRef dari browser dapat dipalsukan. Principal gateway adalah sumber
    // tunggal kepemilikan tenant baru maupun tenant yang sudah ada.
    const ownerRef = principal.subject;
    const idemKey = str(body.idempotencyKey, 120);
    const requestedOutletId = outletRef(body.outletId);
    const txns: SyncTxn[] = Array.isArray(body.transactions) ? body.transactions : [];

    if (!businessId || !sector || !SECTOR_SET.has(sector)) {
      return res.status(400).json({
        ok: false,
        error: 'BAD_REQUEST',
        detail: 'businessId dan sector wajib; sector harus salah satu dari ' + SECTORS.join(', '),
      });
    }
    if (body.outletId && !requestedOutletId) return res.status(400).json({ok:false,error:'INVALID_OUTLET_ID'});
    if (txns.length > MAX_BATCH) {
      return res.status(413).json({
        ok: false,
        error: 'BATCH_TOO_LARGE',
        detail: `Maksimal ${MAX_BATCH} transaksi per kiriman. Pecah antriannya.`,
      });
    }
    if(!txns.length || txns.some(x=>!x || !str(x.clientTxnId,64) || !Array.isArray(x.items) || !x.items.length ||
      !Number.isFinite(x.subtotal) || !Number.isFinite(x.totalAmount) || x.subtotal<0 || x.totalAmount<0 ||
      Math.abs(x.totalAmount-(x.subtotal-(x.discountAmount||0)+(x.taxAmount||0)+(x.serviceChargeAmount||0)))>0.02 ||
      x.items.some(i=>!i || typeof i.productName!=='string' || !i.productName.trim() || !Number.isFinite(i.unitPrice) || i.unitPrice<0 || !Number.isFinite(i.quantity) || i.quantity<=0 || i.quantity>999999999 || Math.abs(i.quantity*1000-Math.round(i.quantity*1000))>0.001)))
      return res.status(400).json({ok:false,error:'INVALID_TRANSACTIONS'});

    try {
      const out = await db.tx(async (c) => {
        await assertBusinessCanBeClaimed(c, businessId, ownerRef);
        // Batch yang persis sama pernah diterima? Jawab dengan hasil lama.
        if (idemKey) {
          const prev = await c.query(
            `SELECT business_id, rows_accepted, rows_duplicate FROM pos.sync_receipts WHERE idempotency_key = $1`,
            [idemKey]
          );
          if (prev.rows.length) {
            if (prev.rows[0].business_id !== businessId) throw new BillingError(409, 'IDEMPOTENCY_KEY_CONFLICT');
            return {
              replayed: true,
              accepted: prev.rows[0].rows_accepted,
              duplicates: prev.rows[0].rows_duplicate,
              tenantId: null as string | null,
            };
          }
        }

        /* -- MODEL B: TENANT -> MERCHANT -> OUTLET ------------------------- */
        const freeScope = await resolveFreeSyncScope(c, ownerRef, sector);
        let tenantId: string;
        let merchantId: string;
        let outletId: string;
        if (freeScope) {
          tenantId = freeScope.tenant_id;
          merchantId = freeScope.merchant_id;
          outletId = freeScope.outlet_id;
          await assertTenantWritable(c, tenantId);
        } else {
        // Tenant (owner level)
        const tenantExternalRef = ownerRef || `tenant_${businessId}`;
        const existingTenant = await tenantForPrincipal(c, { subject: ownerRef });
        const t = existingTenant ? { rows: [{ id: existingTenant }] } : await c.query(
          `INSERT INTO internal.tenants (id, name, external_ref, owner_user_ref)
           VALUES (uuidv7(), $1, $2, $3)
           ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [storeName, tenantExternalRef, ownerRef]
        );
        tenantId = t.rows[0].id;
        await assertTenantWritable(c,tenantId);

        // Merchant (business level)
        const m = await c.query(
          `INSERT INTO internal.merchants (id, tenant_id, name, business_sector, external_ref)
           VALUES (uuidv7(), $1, $2, $3, $4)
           ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [tenantId, storeName, sector, businessId]
        );
        merchantId = m.rows[0].id;

        // Outlet (store branch level)
        const outq = await c.query(
          `SELECT id FROM internal.outlets WHERE merchant_id = $1 AND is_active
             AND ($2::uuid IS NULL OR id = $2::uuid) ORDER BY created_at ASC LIMIT 1`,
          [merchantId, requestedOutletId]
        );
        if (!outq.rows.length) throw new BillingError(409, 'OUTLET_SETUP_REQUIRED');
        outletId = outq.rows[0].id;
        }
        const defaultInventoryLocationId=await ensureInventoryLocation(c,tenantId,merchantId,outletId);
        await c.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.merchant_id',$2,true)",[tenantId,merchantId]);
        const financialScope={tenantId,merchantId,outletId,sector:sector as Sector,actorRef:ownerRef};

        /* -- STAF & PRODUK -------------------------------------------------- */
        const cashierCache = new Map<string, string>();
        const productCache = new Map<string, string>();
        const productLimit = await productLimitForTenant(c, tenantId);
        const existingProductCount = await c.query(
          `SELECT COUNT(*)::int AS count FROM pos.products WHERE tenant_id = $1`,
          [tenantId]
        );
        let productCount = Number(existingProductCount.rows[0]?.count ?? 0);

        const resolveCashier = async (ref: string | null, name: string | null, role: string | null) => {
          const free=await freePlanState(c,tenantId);
          if(free.free) {
            if(ref!==free.ownerId) throw new SyncAccessError('FREE_OWNER_ONLY');
            if (cashierCache.has(ref!)) return cashierCache.get(ref!)!;
            // The historical transaction FK still targets pos.users. Mirror the
            // SAME verified owner ID, not a new Auth identity or staff membership.
            // No shared/default PIN and no update to existing identity records.
            await c.query(`INSERT INTO pos.tenants(id,name,business_sector,owner_user_ref)
              SELECT id,name,business_sector,owner_user_ref FROM internal.tenants WHERE id=$1
              ON CONFLICT(id) DO NOTHING`,[tenantId]);
            const owner = await c.query(`INSERT INTO pos.users(id,tenant_id,name,username,pin,role,external_ref)
              SELECT u.id,$1,left(u.full_name,100),'owner_'||u.id::text,$3,'ADMIN',u.id::text
              FROM internal.users u WHERE u.id::text=$2 AND u.is_active
              ON CONFLICT(id) DO NOTHING RETURNING id`,[tenantId,free.ownerId,randomBytes(32).toString('hex')]);
            if (!owner.rows.length) {
              const existing = await c.query(`SELECT p.id FROM pos.users p JOIN internal.users u ON u.id=p.id
                WHERE p.id::text=$1 AND u.is_active`,[free.ownerId]);
              if (!existing.rows.length) throw new SyncAccessError('FREE_OWNER_UNAVAILABLE');
            }
            cashierCache.set(ref!,free.ownerId!);
            return free.ownerId!;
          }
          const key = ref || name;
          if (!key) return null;
          if (cashierCache.has(key)) return cashierCache.get(key)!;

          // Never fabricate global identities from a client cashier name/ref.
          // The legacy FK targets pos.users; a verified owner may be mirrored
          // with the same ID, while unresolved historical staff remain nullable.
          if (ref === ownerRef) {
            await c.query(`INSERT INTO pos.tenants(id,name,business_sector,owner_user_ref)
              SELECT id,name,business_sector,owner_user_ref FROM internal.tenants WHERE id=$1
              ON CONFLICT(id) DO NOTHING`,[tenantId]);
            await c.query(`INSERT INTO pos.users(id,tenant_id,name,username,pin,role,external_ref)
              SELECT u.id,$1,left(u.full_name,100),'owner_'||u.id::text,$3,'ADMIN',u.id::text
              FROM internal.users u WHERE u.id::text=$2 AND u.is_active
              ON CONFLICT(id) DO NOTHING`,[tenantId,ownerRef,randomBytes(32).toString('hex')]);
          }
          const verified = await c.query(`SELECT id FROM pos.users
            WHERE tenant_id=$1 AND (id::text=$2 OR external_ref=$2) LIMIT 1`,[tenantId,ref]);
          const userId = verified.rows[0]?.id ?? null;
          cashierCache.set(key, userId);
          return userId;
        };

        const resolveProduct = async (i: SyncItem) => {
          assertFreeScope(await freePlanState(c,tenantId),sector,[i.productRef || '']);
          const key = i.productRef || i.productName;
          if (!key) return null;
          if (productCache.has(key)) return productCache.get(key)!;

          const found = await c.query(
            `SELECT id, outlet_id FROM pos.products WHERE tenant_id = $1
              AND (external_ref = $2 OR (NOT $4::boolean AND name = $3)) LIMIT 1`,
            [tenantId, i.productRef ?? null, i.productName, !!freeScope]
          );
          if (freeScope && found.rows[0] && found.rows[0].outlet_id !== outletId) {
            throw new FreePlanAccessError('FREE_PRODUCT_BRANCH_MISMATCH');
          }
          let id: string;
          if (found.rows.length) {
            id = found.rows[0].id;
          } else {
            if (productLimit >= 0 && productCount >= productLimit) {
              throw new ProductLimitError('PRODUCT_LIMIT_EXCEEDED');
            }
            const ins = await c.query(
              `INSERT INTO pos.products (id, tenant_id, merchant_id, outlet_id, name, sku, price, cost_price,
                                     business_sector, business_id, category_name,
                                     description, external_ref)
               VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
              [
                tenantId,
                merchantId,
                outletId,
                i.productName.slice(0, 100),
                (i.productRef || i.productName).slice(0, 50),
                num(i.unitPrice),
                num(i.unitCost),
                sector,
                businessId,
                str(i.categoryName, 100),
                str(i.productDescription, 300),
                i.productRef ?? null,
              ]
            );
            id = ins.rows[0].id;
            productCount++;
          }
          productCache.set(key, id);
          return id;
        };

        /* -- TRANSAKSI ------------------------------------------------------ */
        let accepted = 0;
        let duplicates = 0;
        let voided = 0;

        for (const x of txns) {
          const clientId = str(x.clientTxnId, 64);
          if (!clientId || !Array.isArray(x.items) || !x.items.length) continue;

          const cashierId = await resolveCashier(
            str(x.cashierRef, 96),
            str(x.cashierName, 100),
            str(x.cashierRole, 24)
          );

          const subtotal = Math.max(0, num(x.subtotal));
          const discount = Math.max(0, num(x.discountAmount));
          const tax = Math.max(0, num(x.taxAmount));
          const serviceCharge = Math.max(0, num(x.serviceChargeAmount));
          const total = Math.max(0, num(x.totalAmount, subtotal - discount + tax + serviceCharge));
          const appModule = ['POS', 'TABLES', 'CUSTOMERS'].includes(String(x.appModule))
            ? String(x.appModule)
            : 'POS';

          const paymentMethod = str(x.paymentMethod, 20) ?? 'CASH';
          const paymentStatus = str(x.paymentStatus, 20) ?? 'PAID';
          const isVoid = paymentStatus === 'CANCELLED';
          const orderStatus = isVoid ? 'VOIDED' : (paymentStatus === 'PENDING' ? 'PENDING_PAYMENT' : 'COMPLETED');

          const ins = await c.query(
            `INSERT INTO pos.transactions
               (id, tenant_id, merchant_id, outlet_id, cashier_user_id, subtotal, discount_amount, tax_amount,
                service_charge_amount, total_amount, payment_method, order_status,
                business_sector, business_id, app_module, order_type, invoice_number,
                client_txn_id, shift_id, business_date, completed_at, cancelled_at, voided_at, created_at)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                     $18::uuid, $19::date, $20::timestamptz, $21::timestamptz, $22::timestamptz, COALESCE($23::timestamptz, CURRENT_TIMESTAMP))
             ON CONFLICT (tenant_id, client_txn_id) WHERE client_txn_id IS NOT NULL
               DO NOTHING
             RETURNING id`,
            [
              tenantId,
              merchantId,
              outletId,
              cashierId,
              subtotal,
              discount,
              tax,
              serviceCharge,
              total,
              paymentMethod,
              orderStatus,
              sector,
              businessId,
              appModule,
              str(x.orderType, 16),
              str(x.invoiceNumber, 32),
              clientId,
              outletRef(x.shiftId),
              str(x.businessDate, 10) ?? (x.createdAt ? x.createdAt.split('T')[0] : null),
              x.completedAt ?? (orderStatus === 'COMPLETED' ? x.createdAt : null),
              x.cancelledAt ?? (isVoid ? x.createdAt : null),
              x.voidedAt ?? null,
              x.createdAt ?? null,
            ]
          );

          // Tidak ada baris kembali = sudah pernah masuk. Ini jalur yang
          // menyelamatkan omzet, bukan kasus tepi.
          if (!ins.rows.length) {
            duplicates++;
            const original=(await c.query(`SELECT * FROM pos.transactions WHERE tenant_id=$1 AND client_txn_id=$2 FOR UPDATE`,[tenantId,clientId])).rows[0];
            if(!original || original.merchant_id!==merchantId || (paymentStatus!=='CANCELLED'&&original.outlet_id!==outletId) ||
              Number(original.total_amount)!==total || Number(original.subtotal)!==subtotal)
              throw new FinanceError(409,'TRANSACTION_ID_CONFLICT');

            /*
             * KECUALI kalau kiriman ini adalah PEMBATALAN transaksi yang sudah
             * tersimpan.
             *
             * Void terjadi setelah struk tercetak, jadi selalu datang sebagai
             * kiriman kedua untuk clientTxnId yang sama. Kalau diperlakukan
             * sebagai duplikat biasa, pembatalannya hilang dan admin panel terus
             * menghitung uang yang sudah dikembalikan ke pelanggan.
             *
             * Hanya perpindahan ke CANCELLED yang diterima. Arah sebaliknya —
             * "menghidupkan lagi" transaksi yang sudah dibatalkan — tidak
             * dilayani; itu harus jadi transaksi baru dengan struk baru.
             */
            const status = str(x.paymentStatus, 20);
            if (status === 'CANCELLED') {
              const upd = await c.query(
                `UPDATE pos.transactions
                    SET order_status = 'VOIDED',
                        voided_at = COALESCE($3::timestamptz, CURRENT_TIMESTAMP)
                  WHERE tenant_id = $1 AND client_txn_id = $2 AND merchant_id = $4
                    AND order_status NOT IN ('VOIDED','CANCELLED')
                RETURNING id`,
                [tenantId, clientId, x.voidedAt ?? x.createdAt ?? null,merchantId]
              );
              if (upd.rows.length) {
                const voidedTxnId = upd.rows[0].id;
                const cashBalance=Number((await c.query('SELECT COALESCE(SUM(amount),0) AS amount FROM pos.cash_ledger WHERE transaction_id=$1 AND tenant_id=$2',[voidedTxnId,tenantId])).rows[0].amount);
                if(cashBalance!==0)await c.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,transaction_id,note,occurred_at)
                  VALUES($1,$2,$3,$4,'VOID',$5,$6,'Pembatalan transaksi',$7) ON CONFLICT(tenant_id,client_event_id) DO NOTHING`,
                  [tenantId,merchantId,original.outlet_id,'void:'+voidedTxnId,-cashBalance,voidedTxnId,x.voidedAt||new Date().toISOString()]);
                await c.query(
                  `UPDATE pos.payments SET payment_status = 'REFUNDED' WHERE transaction_id = $1`,
                  [voidedTxnId]
                );

                /*
                 * PENGEMBALIAN STOK SAAT VOID.
                 *
                 * Setiap item dari transaksi yang dibatalkan dikembalikan ke
                 * inventory ledger sebagai delta positif. Trigger
                 * trg_apply_inventory_transaction menambah saldo secara atomik.
                 *
                 * Idempoten: void hanya terjadi sekali karena UPDATE di atas
                 * mensyaratkan order_status <> 'VOIDED' — kiriman kedua tidak
                 * menghasilkan baris RETURNING, jadi blok ini tidak dimasuki.
                 */
                const voidedItems = await c.query(
                  `SELECT ti.product_id, GREATEST(COALESCE(ti.quantity_exact,ti.quantity)-COALESCE((SELECT SUM(ri.quantity) FROM pos.transaction_refund_items ri WHERE ri.transaction_item_id=ti.id),0),0) AS quantity,
                          p.inventory_item_id, p.merchant_id, tx.outlet_id
                     FROM pos.transaction_items ti
                     JOIN pos.products p ON p.id = ti.product_id
                     JOIN pos.transactions tx ON tx.id=ti.transaction_id
                    WHERE ti.transaction_id = $1
                      AND p.inventory_item_id IS NOT NULL`,
                  [voidedTxnId]
                );
                for (const vi of voidedItems.rows) {
                  const fallbackLocation=vi.outlet_id===outletId?defaultInventoryLocationId
                    :await ensureInventoryLocation(c,tenantId,merchantId,vi.outlet_id);
                  await c.query(
                    `INSERT INTO pos.inventory_transactions
                       (id, tenant_id, merchant_id, outlet_id, location_id,
                        inventory_item_id, quantity_delta, reference_type,
                        reference_id, reason, created_at)
                     VALUES (
                       uuidv7(), $1, $2, $3,
                       COALESCE((SELECT location_id FROM pos.inventory_balances
                         WHERE inventory_item_id = $5 AND outlet_id = $3 AND location_id IS NOT NULL
                         ORDER BY updated_at DESC LIMIT 1),$7::uuid),
                       $5, $4, 'VOID_RESTORE', $6,
                       'Pengembalian stok — transaksi dibatalkan', CURRENT_TIMESTAMP)`,
                    [tenantId, vi.merchant_id, vi.outlet_id, vi.quantity, vi.inventory_item_id, voidedTxnId,fallbackLocation]
                  );
                }

                voided++;
                await writeActivity(c, {
                  merchantId,
                  tenantId,
                  businessSector: sector as Sector,
                  businessId,
                  appModule: 'POS',
                  eventType: 'TRANSACTION_VOID',
                  severity: 'WARNING',
                  actorName: str(x.cashierName, 100),
                  actorRole: str(x.cashierRole, 24),
                  transactionId: voidedTxnId,
                  amountIdr: total,
                  summary: `Transaksi ${str(x.invoiceNumber, 64) ?? clientId} dibatalkan`,
                  detail: { clientTxnId: clientId },
                });
              }
            }
            if(status!=='CANCELLED'&&x.tenders)await applyTenders(c,financialScope,original.id,x.tenders);
            if(status!=='CANCELLED')for(const refund of x.refunds||[])await applyRefund(c,financialScope,original.id,refund);
            continue;
          }

          const txnId: string = ins.rows[0].id;
          await c.query('UPDATE pos.transactions SET client_shift_id=$2 WHERE id=$1',[txnId,str(x.shiftId,128)]);

          const pStatus = isVoid ? 'REFUNDED' : (paymentStatus === 'PENDING' ? 'PENDING' : 'PAID');
          if(x.tenders){if(isVoid)throw new FinanceError(400,'VOID_TENDER_IMPORT_REQUIRES_REVIEW');await applyTenders(c,financialScope,txnId,x.tenders);}
          else
          await c.query(
            `INSERT INTO pos.payments
               (id, tenant_id, merchant_id, outlet_id, transaction_id, payment_method, payment_status, amount, gateway_provider)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, 'MANUAL_CASH')
             ON CONFLICT DO NOTHING RETURNING id`,
            [tenantId, merchantId, outletId, txnId, paymentMethod, pStatus, total]
          ).then(async payment=>{
            if(payment.rows.length && pStatus==='PAID' && paymentMethod==='CASH')
              await c.query(`INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,transaction_id,note,actor_ref,occurred_at)
                VALUES($1,$2,$3,$4,'SALE',$5,$6,'Pembayaran tunai',$7,COALESCE($8::timestamptz,now())) ON CONFLICT(tenant_id,client_event_id) DO NOTHING`,
                [tenantId,merchantId,outletId,'payment:'+payment.rows[0].id,total,txnId,ownerRef,x.createdAt||null]);
          });

          for (const i of x.items) {
            const productId = await resolveProduct(i);
            if (!productId) continue;
            const qty = num(i.quantity, 1);
            const unitPrice = Math.max(0, num(i.unitPrice));
            const unitCost = Math.max(0, num(i.unitCost));
            const totalPrice = Math.max(0, num(i.totalPrice, unitPrice * qty));
            await c.query(
              `INSERT INTO pos.transaction_items
                 (id, transaction_id, tenant_id, product_id, product_name, unit_price,
                  quantity, total_price, business_sector, category_name, unit_cost,
                  product_description,client_item_id,quantity_exact)
               VALUES (uuidv7(), $1, $2, $3, $4, $5,CEIL($6::numeric)::int, $7, $8, $9, $10, $11,$12,$6)`,
              [
                txnId,
                tenantId,
                productId,
                i.productName.slice(0, 100),
                unitPrice,
                qty,
                totalPrice,
                sector,
                str(i.categoryName, 100),
                unitCost,
                str(i.productDescription, 300),
                str(i.clientItemId,128),
              ]
            );

            /*
             * PENGURANGAN STOK ATOMIK DI SERVER.
             *
             * Jika produk terhubung ke inventory item (pos.products.inventory_item_id),
             * sisipkan baris ke pos.inventory_transactions dengan delta negatif.
             * Trigger trg_apply_inventory_transaction (migrasi 0024) secara atomik
             * mengeksekusi: current_stock = current_stock + quantity_delta
             *
             * Aman terhadap concurrent updates karena:
             *  - PostgreSQL row-level lock pada UPDATE di trigger bersifat atomic
             *  - Tidak ada read-then-write di level aplikasi
             *  - Idempoten: jika transaksi duplikat ditolak oleh ON CONFLICT pada
             *    pos.transactions (L280), loop ini tidak dimasuki sama sekali
             */
            if (!isVoid) {
              await c.query(
                `INSERT INTO pos.inventory_transactions
                   (id, tenant_id, merchant_id, outlet_id, location_id,
                    inventory_item_id, quantity_delta, reference_type,
                    reference_id, reason, created_at)
                 SELECT
                   uuidv7(), p.tenant_id, p.merchant_id, $4::uuid,
                   COALESCE((SELECT ib.location_id FROM pos.inventory_balances ib
                     WHERE ib.inventory_item_id = p.inventory_item_id
                       AND ib.outlet_id = $4::uuid AND ib.location_id IS NOT NULL
                     ORDER BY ib.updated_at DESC LIMIT 1),$5::uuid),
                   p.inventory_item_id,
                   -($2::numeric),
                   'SALE_DEDUCT',
                   $3,
                   'Penjualan POS',
                   CURRENT_TIMESTAMP
                 FROM pos.products p
                 WHERE p.id = $1
                   AND p.inventory_item_id IS NOT NULL`,
                [productId, qty, txnId,outletId,defaultInventoryLocationId]
              );
            }
          }
          for(const refund of x.refunds||[])await applyRefund(c,financialScope,txnId,refund);
          accepted++;
        }

        if (idemKey) {
          await c.query(
            `INSERT INTO pos.sync_receipts (idempotency_key, tenant_id, business_id,
                                        rows_accepted, rows_duplicate)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [idemKey, tenantId, businessId, accepted, duplicates]
          );
        }

        if (accepted > 0) {
          await writeActivity(c, {
            merchantId,
            tenantId,
            businessSector: sector as Sector,
            businessId,
            appModule: 'SYNC',
            eventType: 'SYNC_BATCH',
            severity: 'INFO',
            summary: `Sinkronisasi ${accepted} transaksi dari perangkat kasir`,
            detail: { accepted, duplicates, batch: txns.length },
          });
        }

        return { replayed: false, accepted, duplicates, voided, tenantId };
      });

      res.json({ ok: true, ...out });
    } catch (err) {
      if(err instanceof FinanceError) return res.status(err.status).json({ok:false,error:err.message});
      if (err instanceof FreePlanAccessError) return res.status(403).json({ok:false,error:err.message});
      if(err instanceof BillingError) return res.status(err.status).json({ok:false,error:err.message});
      console.error('[sync] gagal:', (err as Error).message);
      if (err instanceof SyncAccessError) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
      if (err instanceof ProductLimitError) return res.status(409).json({ ok: false, error: 'PRODUCT_LIMIT_EXCEEDED' });
      res.status(500).json({ ok: false, error: 'SYNC_FAILED' });
    }
  });

  /**
   * POST /api/v1/sync/catalog
   *
   * Mengirim SELURUH katalog satu unit usaha, bukan yang berubah saja.
   *
   * Kenapa kirim semuanya: melacak perubahan di sisi klien menuntut jurnal
   * perubahan yang aplikasi ini belum punya, dan jurnal yang meleset satu kali
   * akan menghasilkan katalog yang berbeda selamanya tanpa ada yang menyadari.
   * Katalog sebuah toko berukuran puluhan sampai ratusan baris — cukup kecil
   * untuk dikirim utuh, dan hasilnya konvergen: apa pun keadaan awalnya,
   * setelah satu kiriman kedua sisi identik.
   *
   * Produk yang HILANG dari kiriman ditandai tidak tersedia, bukan dihapus.
   * Menghapusnya akan memutus baris struk yang menunjuk produk itu.
   */
  app.post('/api/v1/sync/catalog', async (req, res) => {
    const b = req.body ?? {};
    const businessId = str(b.businessId, 96);
    const sector = str(b.sector, 16);
    const storeName = str(b.storeName, 100) ?? 'Tanpa Nama';
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    const ownerRef = principal.subject;
    const products: any[] = Array.isArray(b.products) ? b.products : [];
    const requestedOutletId = outletRef(b.outletId);

    if (!businessId || !sector || !SECTOR_SET.has(sector)) {
      return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
    }
    if (b.outletId && !requestedOutletId) return res.status(400).json({ok:false,error:'INVALID_OUTLET_ID'});
    if (products.length > 2000) {
      return res.status(413).json({ ok: false, error: 'CATALOG_TOO_LARGE' });
    }

    const desiredProductRefs = new Set(
      products.map((p) => str(p?.id, 96)).filter((ref): ref is string => !!ref)
    );

    try {
      const out = await db.tx(async (c) => {
        await assertBusinessCanBeClaimed(c, businessId, ownerRef);
        const freeScope = await resolveFreeSyncScope(c, ownerRef, sector);
        let tenantId: string;
        let merchantId: string;
        let outletId: string;
        if (freeScope) {
          tenantId = freeScope.tenant_id;
          merchantId = freeScope.merchant_id;
          outletId = freeScope.outlet_id;
          await assertTenantWritable(c, tenantId);
        } else {
        const tenantExternalRef = ownerRef || `tenant_${businessId}`;
        const existingTenant = await tenantForPrincipal(c, { subject: ownerRef });
        const t = existingTenant ? { rows: [{ id: existingTenant }] } : await c.query(
          `INSERT INTO internal.tenants (id, name, external_ref, owner_user_ref)
           VALUES (uuidv7(), $1, $2, $3)
           ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [storeName, tenantExternalRef, ownerRef]
        );
        tenantId = t.rows[0].id;
        await assertTenantWritable(c,tenantId);

        const m = await c.query(
          `INSERT INTO internal.merchants (id, tenant_id, name, business_sector, external_ref)
           VALUES (uuidv7(), $1, $2, $3, $4)
           ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [tenantId, storeName, sector, businessId]
        );
        merchantId = m.rows[0].id;

        const productLimit = await productLimitForTenant(c, tenantId);
        if (productLimit >= 0 && desiredProductRefs.size > productLimit) {
          throw new ProductLimitError('PRODUCT_LIMIT_EXCEEDED');
        }

        const outq = await c.query(
          `SELECT id FROM internal.outlets WHERE merchant_id = $1 AND is_active
             AND ($2::uuid IS NULL OR id = $2::uuid) ORDER BY created_at ASC LIMIT 1`,
          [merchantId, requestedOutletId]
        );
        if (!outq.rows.length) throw new BillingError(409, 'OUTLET_SETUP_REQUIRED');
        outletId = outq.rows[0].id;
        }
        assertFreeScope(await freePlanState(c,tenantId),sector,[...desiredProductRefs]);
        if (freeScope) {
          const misplaced = await c.query(`SELECT id FROM pos.products WHERE tenant_id=$1
            AND external_ref=ANY($2::text[]) AND outlet_id IS DISTINCT FROM $3::uuid LIMIT 1`,
          [tenantId,[...desiredProductRefs],outletId]);
          if (misplaced.rows.length) throw new FreePlanAccessError('FREE_PRODUCT_BRANCH_MISMATCH');
        }
        let upserted = 0;

        for (const p of products) {
          const ref = str(p.id, 96);
          const name = str(p.name, 100);
          if (!ref || !name) continue;

          /*
           * CATALOG SYNC: hanya metadata produk.
           *
           * Kolom `stock` dan `min_stock_alert` sudah di-DROP dari pos.products
           * oleh migrasi 0023 dan dipindahkan ke pos.inventory_balances. Stok
           * dimutasi secara atomik melalui pos.inventory_transactions ledger
           * (di endpoint /api/v1/sync/transactions), bukan melalui snapshot
           * overwrite dari klien.
           */
          await c.query(
            `INSERT INTO pos.products
               (id, tenant_id, merchant_id, outlet_id, name, sku, price, cost_price, is_available,
                business_sector, business_id, category_name, description,
                unit, external_ref, catalog_synced_at)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                     $13, $14, CURRENT_TIMESTAMP)
             ON CONFLICT (tenant_id, external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET
               name              = EXCLUDED.name,
               sku               = EXCLUDED.sku,
               price             = EXCLUDED.price,
               cost_price        = EXCLUDED.cost_price,
               is_available      = EXCLUDED.is_available,
               category_name     = EXCLUDED.category_name,
               description       = EXCLUDED.description,
               unit              = EXCLUDED.unit,
               catalog_synced_at = CURRENT_TIMESTAMP`,
            [
              tenantId,
              merchantId,
              outletId,
              name,
              str(p.sku, 50) ?? ref,
              num(p.price),
              num(p.costPrice),
              p.isAvailable !== false,
              sector,
              businessId,
              str(p.categoryName, 100),
              str(p.description, 300),
              str(p.unit, 20),
              ref,
            ]
          );
          upserted++;
        }

        // Older clients still send whole catalog snapshots. Never interpret an
        // omitted row as a deletion: an offline/stale device could hide live
        // products. Versioned shared-state tombstones perform explicit deletion.
        return { tenantId, upserted, retired: 0 };
      });

      res.json({ ok: true, ...out });
    } catch (err) {
      if (err instanceof FreePlanAccessError) return res.status(403).json({ok:false,error:err.message});
      if(err instanceof BillingError) return res.status(err.status).json({ok:false,error:err.message});
      console.error('[sync] katalog gagal:', (err as Error).message);
      if (err instanceof SyncAccessError) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
      if (err instanceof ProductLimitError) return res.status(409).json({ ok: false, error: 'PRODUCT_LIMIT_EXCEEDED' });
      res.status(500).json({ ok: false, error: 'CATALOG_SYNC_FAILED' });
    }
  });

  /** Kejadian non-penjualan dari aplikasi kasir. */
  app.post('/api/v1/sync/activity', async (req, res) => {
    const b = req.body ?? {};
    const businessId = str(b.businessId, 96);
    if (!businessId) return res.status(400).json({ ok: false, error: 'BUSINESS_ID_REQUIRED' });
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    if (!(await canAccessBusiness(db, principal, businessId))) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    }

    const t = await db.query(`SELECT id, tenant_id, business_sector FROM internal.merchants WHERE external_ref = $1`, [
      businessId,
    ]);
    if (!t.rows.length) return res.status(404).json({ ok: false, error: 'MERCHANT_NOT_SYNCED' });

    const id = await writeActivity(db, {
      merchantId: t.rows[0].id,
      tenantId: t.rows[0].tenant_id,
      businessSector: t.rows[0].business_sector,
      businessId,
      appModule: String(b.appModule ?? 'POS'),
      eventType: String(b.eventType ?? 'UNKNOWN'),
      severity: String(b.severity ?? 'INFO'),
      actorName: str(b.actorName, 100),
      actorRole: str(b.actorRole, 24),
      amountIdr: b.amountIdr == null ? null : num(b.amountIdr),
      summary: String(b.summary ?? 'Kejadian tanpa keterangan'),
      detail: typeof b.detail === 'object' && b.detail ? b.detail : {},
      occurredAt: str(b.occurredAt, 40),
    });

    if (!id) return res.status(400).json({ ok: false, error: 'INVALID_ACTIVITY' });
    res.json({ ok: true, id });
  });

  /** Status sinkronisasi satu unit usaha — dipakai indikator di aplikasi kasir. */
  app.get('/api/v1/sync/status', async (req, res) => {
    const businessId = str(req.query.businessId, 96);
    if (!businessId) return res.status(400).json({ ok: false, error: 'BUSINESS_ID_REQUIRED' });
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    if (!(await canAccessBusiness(db, principal, businessId))) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    }

    const { rows } = await db.query(
      `SELECT t.id, t.name, t.business_sector,
              COUNT(x.id)::int              AS synced_transactions,
              COALESCE(SUM(x.total_amount), 0) AS synced_revenue,
              MAX(x.created_at)             AS last_transaction_at
         FROM internal.tenants t
         LEFT JOIN pos.transactions x ON x.tenant_id = t.id
        WHERE t.external_ref = $1
        GROUP BY t.id, t.name, t.business_sector`,
      [businessId]
    );

    if (!rows.length) return res.json({ ok: true, synced: false });
    res.json({ ok: true, synced: true, ...rows[0] });
  });

  /**
   * POST /api/v1/sync/customers
   *
   * {
   *   businessId, sector, storeName,
   *   customers: [ { id, name, phone, email, address, notes, totalSpent, ordersCount, lastVisitAt } ]
   * }
   */
  app.post('/api/v1/sync/customers', async (req, res) => {
    const body = req.body ?? {};
    const businessId = str(body.businessId, 96);
    const sector = str(body.sector, 16);
    const storeName = str(body.storeName, 100) ?? 'Tanpa Nama';
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    const ownerRef = principal.subject;
    const customers: any[] = Array.isArray(body.customers) ? body.customers : [];

    if (!businessId || !sector || !SECTOR_SET.has(sector)) {
      return res.status(400).json({
        ok: false,
        error: 'BAD_REQUEST',
        detail: 'businessId dan sector wajib',
      });
    }

    try {
      const result = await db.tx(async (c) => {
        await assertBusinessCanBeClaimed(c, businessId, ownerRef);
        const freeScope = await resolveFreeSyncScope(c, ownerRef, sector);
        let tenantId: string;
        let merchantId: string;
        if (freeScope) {
          tenantId = freeScope.tenant_id;
          merchantId = freeScope.merchant_id;
          await assertTenantWritable(c, tenantId);
        } else {
          const tenantExternalRef = ownerRef || `tenant_${businessId}`;
          const existingTenant = await tenantForPrincipal(c, { subject: ownerRef });
          const t = existingTenant ? { rows: [{ id: existingTenant }] } : await c.query(
            `INSERT INTO internal.tenants (id, name, external_ref, owner_user_ref)
             VALUES (uuidv7(), $1, $2, $3)
             ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
               DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [storeName, tenantExternalRef, ownerRef]
          );
          tenantId = t.rows[0].id;
          await assertTenantWritable(c, tenantId);

          const m = await c.query(
            `INSERT INTO internal.merchants (id, tenant_id, name, business_sector, external_ref)
             VALUES (uuidv7(), $1, $2, $3, $4)
             ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
               DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [tenantId, storeName, sector, businessId]
          );
          merchantId = m.rows[0].id;
        }

        let upserted = 0;
        for (const cust of customers) {
          const extRef = str(cust.id || cust.external_ref, 96);
          const name = str(cust.name, 120);
          if (!extRef || !name) continue;
          await c.query(
            `INSERT INTO pos.customers (
               tenant_id, merchant_id, external_ref, name, phone, email, address, notes,
               total_spent, orders_count, last_visit_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
             ON CONFLICT (tenant_id, external_ref)
               DO UPDATE SET
                 name = EXCLUDED.name,
                 phone = COALESCE(EXCLUDED.phone, pos.customers.phone),
                 email = COALESCE(EXCLUDED.email, pos.customers.email),
                 address = COALESCE(EXCLUDED.address, pos.customers.address),
                 notes = COALESCE(EXCLUDED.notes, pos.customers.notes),
                 total_spent = EXCLUDED.total_spent,
                 orders_count = EXCLUDED.orders_count,
                 last_visit_at = COALESCE(EXCLUDED.last_visit_at, pos.customers.last_visit_at),
                 updated_at = NOW()`,
            [
              tenantId,
              merchantId,
              extRef,
              name,
              str(cust.phone, 32),
              str(cust.email, 120),
              str(cust.address, 255),
              str(cust.notes, 500),
              num(cust.totalSpent || cust.total_spent),
              num(cust.ordersCount || cust.orders_count),
              cust.lastVisitAt ? new Date(cust.lastVisitAt) : null,
            ]
          );
          upserted++;
        }
        return { ok: true, upserted };
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'CUSTOMER_SYNC_FAILED' });
    }
  });

  /**
   * PULL KATALOG (HIDRASI MULTI-TERMINAL).
   * Membaca produk dan kategori terkini milik tenant untuk mengisi kasir baru.
   */
  app.get('/api/v1/sync/catalog', async (req, res) => {
    const businessId = str(req.query.businessId, 96);
    const sector = str(req.query.sector, 16);
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    const ownerRef = principal.subject;

    if (!businessId || !sector || !SECTOR_SET.has(sector)) {
      return res.status(400).json({ ok: false, error: 'BAD_REQUEST', detail: 'businessId dan sector wajib' });
    }

    try {
      const tenantRes = await db.query(
        `SELECT t.id AS tenant_id, m.id AS merchant_id
           FROM internal.tenants t
           JOIN internal.merchants m ON m.tenant_id = t.id
          WHERE m.external_ref = $1 AND (t.owner_user_ref = $2 OR t.external_ref = $2 OR t.external_ref = $3)`,
        [businessId, ownerRef, `tenant_${businessId}`]
      );
      if (!tenantRes.rows.length) {
        return res.json({ ok: true, products: [], categories: [] });
      }
      const tenantId = tenantRes.rows[0].tenant_id;
      const merchantId = tenantRes.rows[0].merchant_id;
      const prodRes = await db.query(
          `SELECT p.id, p.external_ref, p.name, p.sku, p.price, p.cost_price, p.unit, p.description,
                  p.is_available, COALESCE(p.category_name, 'Lainnya') AS category_name
             FROM pos.products p
            WHERE p.tenant_id = $1 AND p.merchant_id = $2
            ORDER BY p.name ASC`,
          [tenantId, merchantId]
      );
      const categoryId = (r: any) => r.category_id || `category:${r.category_name}`;
      res.json({
        ok: true,
        products: prodRes.rows.map((r: any) => ({
          id: r.external_ref || r.id,
          name: r.name,
          sku: r.sku,
          price: Number(r.price || 0),
          costPrice: Number(r.cost_price || 0),
          unit: r.unit,
          description: r.description,
          categoryName: r.category_name,
          categoryId: categoryId(r),
          isAvailable: Boolean(r.is_available),
        })),
        categories: [...new Map(prodRes.rows.map((r: any) => [categoryId(r), {
          id: categoryId(r), name: r.category_name,
        }])).values()],
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'CATALOG_FETCH_FAILED' });
    }
  });

  /**
   * SINKRONISASI PRESENSI / CLOCK-IN STAF KE POSTGRESQL.
   */
  app.post('/api/v1/sync/attendance', async (req, res) => {
    const body = req.body ?? {};
    const businessId = str(body.businessId, 96);
    const sector = str(body.sector, 16);
    const storeName = str(body.storeName, 100) ?? 'Tanpa Nama';
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    const ownerRef = principal.subject;
    const attendances: any[] = Array.isArray(body.attendances) ? body.attendances : [];

    if (!businessId || !sector || !SECTOR_SET.has(sector)) {
      return res.status(400).json({ ok: false, error: 'BAD_REQUEST', detail: 'businessId dan sector wajib' });
    }

    try {
      const result = await db.tx(async (c) => {
        await assertBusinessCanBeClaimed(c, businessId, ownerRef);
        const freeScope = await resolveFreeSyncScope(c, ownerRef, sector);
        let tenantId: string;
        let merchantId: string;
        let outletId: string | null = null;
        if (freeScope) {
          tenantId = freeScope.tenant_id;
          merchantId = freeScope.merchant_id;
          outletId = freeScope.outlet_id;
          await assertTenantWritable(c, tenantId);
        } else {
          const tenantExternalRef = ownerRef || `tenant_${businessId}`;
          const existingTenant = await tenantForPrincipal(c, { subject: ownerRef });
          const t = existingTenant ? { rows: [{ id: existingTenant }] } : await c.query(
            `INSERT INTO internal.tenants (id, name, external_ref, owner_user_ref)
             VALUES (uuidv7(), $1, $2, $3)
             ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
               DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [storeName, tenantExternalRef, ownerRef]
          );
          tenantId = t.rows[0].id;
          await assertTenantWritable(c, tenantId);

          const m = await c.query(
            `INSERT INTO internal.merchants (id, tenant_id, name, business_sector, external_ref)
             VALUES (uuidv7(), $1, $2, $3, $4)
             ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
               DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [tenantId, storeName, sector, businessId]
          );
          merchantId = m.rows[0].id;
        }

        let upserted = 0;
        for (const att of attendances) {
          const clientAttendanceId = str(att.id, 96);
          const staffId = str(att.staffId, 96);
          const staffName = str(att.staffName, 120);
          const staffRole = str(att.staffRole, 64) || 'STAFF';
          const clockInAt = att.clockInTime ? new Date(att.clockInTime) : new Date();
          const clockOutAt = att.clockOutTime ? new Date(att.clockOutTime) : null;
          const status = str(att.status, 32) || 'CLOCKED_IN';
          if (!clientAttendanceId || !staffId || !staffName) continue;

          await c.query(
            `INSERT INTO pos.staff_attendances (
               tenant_id, merchant_id, outlet_id, client_attendance_id,
               staff_id, staff_name, staff_role, clock_in_at, clock_out_at,
               shift_notes, status, branch_id, branch_name, clock_in_geo, clock_out_geo,
               business_sector, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, NOW())
             ON CONFLICT (tenant_id, client_attendance_id)
               DO UPDATE SET
                 clock_out_at = COALESCE(EXCLUDED.clock_out_at, pos.staff_attendances.clock_out_at),
                 shift_notes = COALESCE(EXCLUDED.shift_notes, pos.staff_attendances.shift_notes),
                 status = EXCLUDED.status,
                 clock_out_geo = COALESCE(EXCLUDED.clock_out_geo, pos.staff_attendances.clock_out_geo),
                 updated_at = NOW()`,
            [
              tenantId,
              merchantId,
              outletId,
              clientAttendanceId,
              staffId,
              staffName,
              staffRole,
              clockInAt,
              clockOutAt,
              str(att.shiftNotes, 500),
              status,
              str(att.branchId, 64),
              str(att.branchName, 100),
              JSON.stringify(att.clockInGeo || null),
              JSON.stringify(att.clockOutGeo || null),
              sector,
            ]
          );
          upserted++;
        }
        return { ok: true, upserted };
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'ATTENDANCE_SYNC_FAILED' });
    }
  });

  /**
   * SINKRONISASI PENGGAJIAN / SLIP GAJI STAF KE POSTGRESQL.
   */
  app.post('/api/v1/sync/payroll', async (req, res) => {
    const body = req.body ?? {};
    const businessId = str(body.businessId, 96);
    const sector = str(body.sector, 16);
    const storeName = str(body.storeName, 100) ?? 'Tanpa Nama';
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
    const ownerRef = principal.subject;
    const slips: any[] = Array.isArray(body.payrollSlips) ? body.payrollSlips : [];

    if (!businessId || !sector || !SECTOR_SET.has(sector)) {
      return res.status(400).json({ ok: false, error: 'BAD_REQUEST', detail: 'businessId dan sector wajib' });
    }

    try {
      const result = await db.tx(async (c) => {
        await assertBusinessCanBeClaimed(c, businessId, ownerRef);
        const freeScope = await resolveFreeSyncScope(c, ownerRef, sector);
        let tenantId: string;
        let merchantId: string;
        if (freeScope) {
          tenantId = freeScope.tenant_id;
          merchantId = freeScope.merchant_id;
          await assertTenantWritable(c, tenantId);
        } else {
          const tenantExternalRef = ownerRef || `tenant_${businessId}`;
          const existingTenant = await tenantForPrincipal(c, { subject: ownerRef });
          const t = existingTenant ? { rows: [{ id: existingTenant }] } : await c.query(
            `INSERT INTO internal.tenants (id, name, external_ref, owner_user_ref)
             VALUES (uuidv7(), $1, $2, $3)
             ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
               DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [storeName, tenantExternalRef, ownerRef]
          );
          tenantId = t.rows[0].id;
          await assertTenantWritable(c, tenantId);

          const m = await c.query(
            `INSERT INTO internal.merchants (id, tenant_id, name, business_sector, external_ref)
             VALUES (uuidv7(), $1, $2, $3, $4)
             ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
               DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [tenantId, storeName, sector, businessId]
          );
          merchantId = m.rows[0].id;
        }

        let upserted = 0;
        for (const slip of slips) {
          const clientSlipId = str(slip.id, 96);
          const staffId = str(slip.staffId, 96);
          const staffName = str(slip.staffName, 120);
          const staffRole = str(slip.staffRole, 64) || 'STAFF';
          const periodMonth = str(slip.periodMonth, 16) || new Date().toISOString().slice(0, 7);
          const periodStart = slip.periodStart ? new Date(slip.periodStart) : new Date();
          const periodEnd = slip.periodEnd ? new Date(slip.periodEnd) : new Date();
          if (!clientSlipId || !staffId || !staffName) continue;

          await c.query(
            `INSERT INTO pos.staff_payrolls (
               tenant_id, merchant_id, client_slip_id, staff_id, staff_name, staff_role,
               period_month, period_start, period_end, days_attended,
               base_salary, allowance, individual_commission, team_pool_commission,
               daily_target_bonus, gross_earnings, deductions, net_salary,
               status, paid_at, payment_method, notes, business_sector, updated_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $15, $16, $17, $18,
               $19, $20, $21, $22, $23, NOW()
             )
             ON CONFLICT (tenant_id, client_slip_id)
               DO UPDATE SET
                 status = EXCLUDED.status,
                 paid_at = COALESCE(EXCLUDED.paid_at, pos.staff_payrolls.paid_at),
                 payment_method = COALESCE(EXCLUDED.payment_method, pos.staff_payrolls.payment_method),
                 notes = COALESCE(EXCLUDED.notes, pos.staff_payrolls.notes),
                 net_salary = EXCLUDED.net_salary,
                 updated_at = NOW()`,
            [
              tenantId,
              merchantId,
              clientSlipId,
              staffId,
              staffName,
              staffRole,
              periodMonth,
              periodStart,
              periodEnd,
              Number(slip.daysAttended) || 0,
              num(slip.baseSalary),
              num(slip.allowance),
              num(slip.individualCommission),
              num(slip.teamPoolCommission),
              num(slip.dailyTargetBonus),
              num(slip.grossEarnings),
              num(slip.deductions),
              num(slip.netSalary),
              str(slip.status, 32) || 'DRAFT',
              slip.paidAt ? new Date(slip.paidAt) : null,
              str(slip.paymentMethod, 64),
              str(slip.notes, 500),
              sector,
            ]
          );
          upserted++;
        }
        return { ok: true, upserted };
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message || 'PAYROLL_SYNC_FAILED' });
    }
  });
}
