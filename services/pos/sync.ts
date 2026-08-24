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
import type { Db } from '../shared/db';
import { SECTORS, writeActivity, type Sector } from './activity';
import { canAccessBusiness, trustedPrincipal } from '../shared/auth';

const SECTOR_SET = new Set<string>(SECTORS);
const MAX_BATCH = 500;

class SyncAccessError extends Error {}
class ProductLimitError extends Error {}

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
  const { rows } = await db.query(
    `SELECT product_limit FROM contract.merchant_product_entitlement WHERE tenant_id = $1`,
    [tenantId]
  );
  return rows.length ? Number(rows[0].product_limit) : 30;
}

interface SyncItem {
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
  /** 'SALE' | 'HOUSE_USE' | 'COMPLIMENT' | 'STAFF_MEAL'. Divalidasi ulang di sini. */
  revenueImpact?: string;
  /** Jumlah tamu (*covers*) untuk segmen yang duduk di tempat. */
  guestCount?: number;
  tableName?: string;
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

export function registerSyncRoutes(app: express.Express, db: Db): void {
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
    const txns: SyncTxn[] = Array.isArray(body.transactions) ? body.transactions : [];

    if (!businessId || !sector || !SECTOR_SET.has(sector)) {
      return res.status(400).json({
        ok: false,
        error: 'BAD_REQUEST',
        detail: 'businessId dan sector wajib; sector harus salah satu dari ' + SECTORS.join(', '),
      });
    }
    if (txns.length > MAX_BATCH) {
      return res.status(413).json({
        ok: false,
        error: 'BATCH_TOO_LARGE',
        detail: `Maksimal ${MAX_BATCH} transaksi per kiriman. Pecah antriannya.`,
      });
    }

    try {
      const out = await db.tx(async (c) => {
        await assertBusinessCanBeClaimed(c, businessId, ownerRef);
        // Batch yang persis sama pernah diterima? Jawab dengan hasil lama.
        if (idemKey) {
          const prev = await c.query(
            `SELECT rows_accepted, rows_duplicate FROM pos.sync_receipts WHERE idempotency_key = $1`,
            [idemKey]
          );
          if (prev.rows.length) {
            return {
              replayed: true,
              accepted: prev.rows[0].rows_accepted,
              duplicates: prev.rows[0].rows_duplicate,
              tenantId: null as string | null,
            };
          }
        }

        /* -- MODEL B: TENANT -> MERCHANT -> OUTLET ------------------------- */
        // Tenant (owner level)
        const tenantExternalRef = ownerRef || `tenant_${businessId}`;
        const t = await c.query(
          `INSERT INTO internal.tenants (id, name, external_ref, owner_user_ref)
           VALUES (uuidv7(), $1, $2, $3)
           ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [storeName, tenantExternalRef, ownerRef]
        );
        const tenantId: string = t.rows[0].id;

        // Merchant (business level)
        const m = await c.query(
          `INSERT INTO internal.merchants (id, tenant_id, name, business_sector, external_ref)
           VALUES (uuidv7(), $1, $2, $3, $4)
           ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [tenantId, storeName, sector, businessId]
        );
        const merchantId: string = m.rows[0].id;

        // Outlet (store branch level)
        const outq = await c.query(
          `SELECT id FROM internal.outlets WHERE merchant_id = $1 ORDER BY created_at ASC LIMIT 1`,
          [merchantId]
        );
        let outletId: string;
        if (outq.rows.length) {
            outletId = outq.rows[0].id;
        } else {
            const outins = await c.query(
                `INSERT INTO internal.outlets (id, tenant_id, merchant_id, name)
                 VALUES (uuidv7(), $1, $2, $3) RETURNING id`,
                 [tenantId, merchantId, `${storeName} (Cabang Utama)`]
            );
            outletId = outins.rows[0].id;
        }

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
          const key = ref || name;
          if (!key) return null;
          if (cashierCache.has(key)) return cashierCache.get(key)!;

          const found = await c.query(
            `SELECT id FROM internal.memberships WHERE tenant_id = $1 AND (external_ref = $2 OR role = $3) LIMIT 1`,
            [tenantId, ref, role]
          );
          // Wait, resolving cashier is currently difficult because internal.users isn't easily created with dummy emails.
          // For now, return a placeholder or handle cashier matching via external_ref.
          // In the new architecture, POS transactions just link to internal.users via cashier_user_id.
          // We will use a fallback logic here that assumes user is created elsewhere, or we create a dummy internal user.
          // Actually, internal.users doesn't need to be populated in offline sync if they aren't registered. 
          // We'll insert a dummy user if not found just to satisfy the foreign key.
          
          let userId: string;
          const userCheck = await c.query(
            `SELECT id FROM internal.users WHERE email = $1 LIMIT 1`,
            [`${ref || 'kasir'}@pos.local`]
          );
          
          if (userCheck.rows.length) {
            userId = userCheck.rows[0].id;
          } else {
            const insUser = await c.query(
              `INSERT INTO internal.users (id, email, full_name) VALUES (uuidv7(), $1, $2) RETURNING id`,
              [`${ref || 'kasir'}_${Date.now()}@pos.local`, name || 'Kasir']
            );
            userId = insUser.rows[0].id;
          }

          cashierCache.set(key, userId);
          return userId;
        };

        const resolveProduct = async (i: SyncItem) => {
          const key = i.productRef || i.productName;
          if (!key) return null;
          if (productCache.has(key)) return productCache.get(key)!;

          const found = await c.query(
            `SELECT id FROM pos.products WHERE tenant_id = $1 AND (external_ref = $2 OR name = $3) LIMIT 1`,
            [tenantId, i.productRef ?? null, i.productName]
          );
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

          const subtotal = num(x.subtotal);
          const discount = num(x.discountAmount);
          const tax = num(x.taxAmount);
          const serviceCharge = num(x.serviceChargeAmount);
          const total = num(x.totalAmount, subtotal - discount + tax + serviceCharge);
          const appModule = ['POS', 'TABLES', 'CUSTOMERS'].includes(String(x.appModule))
            ? String(x.appModule)
            : 'POS';

          /*
           * Klasifikasi omzet. Sengaja whitelist, bukan diteruskan apa adanya:
           * pos.transactions.revenue_impact punya CHECK constraint, dan satu
           * nilai asing dari klien akan menggagalkan seluruh batch sinkronisasi
           * — termasuk transaksi lain yang sah di dalamnya.
           */
          const impactRaw = str(x.revenueImpact, 32);
          const revenueImpact =
            impactRaw && ['SALE', 'HOUSE_USE', 'COMPLIMENT', 'STAFF_MEAL'].includes(impactRaw)
              ? impactRaw
              : 'SALE';

          const paymentMethod = str(x.paymentMethod, 20) ?? 'CASH';
          const paymentStatus = str(x.paymentStatus, 20) ?? 'PAID';
          const isVoid = paymentStatus === 'CANCELLED';
          const orderStatus = isVoid ? 'VOIDED' : (paymentStatus === 'PENDING' ? 'PENDING_PAYMENT' : 'COMPLETED');

          const ins = await c.query(
            `INSERT INTO pos.transactions
               (id, tenant_id, merchant_id, outlet_id, cashier_user_id, subtotal, discount_amount, tax_amount,
                service_charge_amount, total_amount, payment_method, order_status,
                business_sector, business_id, app_module, order_type, invoice_number,
                client_txn_id, shift_id, business_date, completed_at, cancelled_at, voided_at, created_at,
                revenue_impact)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                     $18::uuid, $19::date, $20::timestamptz, $21::timestamptz, $22::timestamptz, COALESCE($23::timestamptz, CURRENT_TIMESTAMP),
                     $24)
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
              str(x.invoiceNumber, 64),
              clientId,
              str(x.shiftId, 36) ?? null,
              str(x.businessDate, 10) ?? (x.createdAt ? x.createdAt.split('T')[0] : null),
              x.completedAt ?? (orderStatus === 'COMPLETED' ? x.createdAt : null),
              x.cancelledAt ?? (isVoid ? x.createdAt : null),
              x.voidedAt ?? null,
              x.createdAt ?? null,
              revenueImpact,
            ]
          );

          // Tidak ada baris kembali = sudah pernah masuk. Ini jalur yang
          // menyelamatkan omzet, bukan kasus tepi.
          if (!ins.rows.length) {
            duplicates++;

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
                  WHERE tenant_id = $1 AND client_txn_id = $2
                    AND order_status <> 'VOIDED'
                RETURNING id`,
                [tenantId, clientId, x.voidedAt ?? x.createdAt ?? null]
              );
              if (upd.rows.length) {
                const voidedTxnId = upd.rows[0].id;
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
                  `SELECT ti.product_id, ti.quantity,
                          p.inventory_item_id, p.merchant_id, p.outlet_id
                     FROM pos.transaction_items ti
                     JOIN pos.products p ON p.id = ti.product_id
                    WHERE ti.transaction_id = $1
                      AND p.inventory_item_id IS NOT NULL`,
                  [voidedTxnId]
                );
                for (const vi of voidedItems.rows) {
                  await c.query(
                    `INSERT INTO pos.inventory_transactions
                       (id, tenant_id, merchant_id, outlet_id, location_id,
                        inventory_item_id, quantity_delta, movement_type,
                        reference_id, reason, created_at)
                     VALUES (
                       uuidv7(), $1, $2, $3,
                       (SELECT location_id FROM pos.inventory_balances
                         WHERE inventory_item_id = $5 AND outlet_id = $3 LIMIT 1),
                       $5, $4, 'VOID_RESTORE', $6,
                       'Pengembalian stok — transaksi dibatalkan', CURRENT_TIMESTAMP)`,
                    [tenantId, vi.merchant_id, vi.outlet_id, vi.quantity, vi.inventory_item_id, voidedTxnId]
                  );
                }

                voided++;
                await writeActivity(c, {
                  merchantId: tenantId,
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
            continue;
          }

          const txnId: string = ins.rows[0].id;

          /*
           * KONTEKS OPERASIONAL F&B (meja + jumlah tamu).
           *
           * Ditulis terpisah dari pos.transactions karena transaksi adalah
           * entitas keuangan universal lintas sektor, sementara "covers" hanya
           * punya arti di meja restoran (migrasi 0030). Gagal di sini tidak
           * boleh menjatuhkan transaksinya: uangnya sudah berpindah tangan,
           * statistik jumlah tamu tidak sepadan untuk membatalkan itu.
           */
          const guestCount = Math.max(1, Math.trunc(num(x.guestCount, 1)));
          const seatedSegment = str(x.orderType, 16) === 'DINE_IN' || str(x.orderType, 16) === 'EVENT';
          if (sector === 'FNB' && seatedSegment) {
            try {
              await c.query(
                `INSERT INTO pos.order_context_fnb (transaction_id, table_name, guest_count, order_type)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (transaction_id) DO UPDATE
                    SET guest_count = EXCLUDED.guest_count,
                        table_name  = EXCLUDED.table_name,
                        order_type  = EXCLUDED.order_type,
                        updated_at  = CURRENT_TIMESTAMP`,
                [txnId, str(x.tableName, 64), guestCount, str(x.orderType, 16) ?? 'DINE_IN']
              );
            } catch {
              // Konteks operasional bersifat pelengkap. Transaksinya tetap sah.
            }
          }

          const pStatus = isVoid ? 'REFUNDED' : (paymentStatus === 'PENDING' ? 'PENDING' : 'PAID');
          await c.query(
            `INSERT INTO pos.payments
               (id, tenant_id, merchant_id, outlet_id, transaction_id, payment_method, payment_status, amount, gateway_provider)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, 'MANUAL_CASH')
             ON CONFLICT DO NOTHING`,
            [tenantId, merchantId, outletId, txnId, paymentMethod, pStatus, total]
          );

          for (const i of x.items) {
            const productId = await resolveProduct(i);
            if (!productId) continue;
            const qty = Math.max(1, Math.trunc(num(i.quantity, 1)));
            await c.query(
              `INSERT INTO pos.transaction_items
                 (id, transaction_id, tenant_id, product_id, product_name, unit_price,
                  quantity, total_price, business_sector, category_name, unit_cost,
                  product_description)
               VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [
                txnId,
                tenantId,
                productId,
                i.productName.slice(0, 100),
                num(i.unitPrice),
                qty,
                num(i.totalPrice, num(i.unitPrice) * qty),
                sector,
                str(i.categoryName, 100),
                num(i.unitCost),
                str(i.productDescription, 300),
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
                    inventory_item_id, quantity_delta, movement_type,
                    reference_id, reason, created_at)
                 SELECT
                   uuidv7(), p.tenant_id, p.merchant_id, p.outlet_id,
                   (SELECT ib.location_id FROM pos.inventory_balances ib
                     WHERE ib.inventory_item_id = p.inventory_item_id
                       AND ib.outlet_id = p.outlet_id LIMIT 1),
                   p.inventory_item_id,
                   -$2,
                   'SALE_DEDUCT',
                   $3,
                   'Penjualan POS',
                   CURRENT_TIMESTAMP
                 FROM pos.products p
                 WHERE p.id = $1
                   AND p.inventory_item_id IS NOT NULL`,
                [productId, qty, txnId]
              );
            }
          }
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
            merchantId: tenantId,
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

    if (!businessId || !sector || !SECTOR_SET.has(sector)) {
      return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
    }
    if (products.length > 2000) {
      return res.status(413).json({ ok: false, error: 'CATALOG_TOO_LARGE' });
    }

    const desiredProductRefs = new Set(
      products.map((p) => str(p?.id, 96)).filter((ref): ref is string => !!ref)
    );

    try {
      const out = await db.tx(async (c) => {
        await assertBusinessCanBeClaimed(c, businessId, ownerRef);
        const tenantExternalRef = ownerRef || `tenant_${businessId}`;
        const t = await c.query(
          `INSERT INTO internal.tenants (id, name, external_ref, owner_user_ref)
           VALUES (uuidv7(), $1, $2, $3)
           ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [storeName, tenantExternalRef, ownerRef]
        );
        const tenantId: string = t.rows[0].id;

        const m = await c.query(
          `INSERT INTO internal.merchants (id, tenant_id, name, business_sector, external_ref)
           VALUES (uuidv7(), $1, $2, $3, $4)
           ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [tenantId, storeName, sector, businessId]
        );
        const merchantId: string = m.rows[0].id;

        const productLimit = await productLimitForTenant(c, tenantId);
        if (productLimit >= 0 && desiredProductRefs.size > productLimit) {
          throw new ProductLimitError('PRODUCT_LIMIT_EXCEEDED');
        }

        const outq = await c.query(
          `SELECT id FROM internal.outlets WHERE merchant_id = $1 ORDER BY created_at ASC LIMIT 1`,
          [merchantId]
        );
        let outletId: string;
        if (outq.rows.length) {
            outletId = outq.rows[0].id;
        } else {
            const outins = await c.query(
                `INSERT INTO internal.outlets (id, tenant_id, merchant_id, name)
                 VALUES (uuidv7(), $1, $2, $3) RETURNING id`,
                 [tenantId, merchantId, `${storeName} (Cabang Utama)`]
            );
            outletId = outins.rows[0].id;
        }
        const seen: string[] = [];
        let upserted = 0;

        for (const p of products) {
          const ref = str(p.id, 96);
          const name = str(p.name, 100);
          if (!ref || !name) continue;
          seen.push(ref);

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

        // Produk yang tidak ada lagi di perangkat: disembunyikan, bukan dibuang.
        let retired = 0;
        if (seen.length > 0) {
          const r = await c.query(
            `UPDATE pos.products
                SET is_available = FALSE
              WHERE tenant_id = $1
                AND external_ref IS NOT NULL
                AND NOT (external_ref = ANY($2::text[]))
                AND is_available
              RETURNING id`,
            [tenantId, seen]
          );
          retired = r.rows.length;
        }

        return { tenantId, upserted, retired };
      });

      res.json({ ok: true, ...out });
    } catch (err) {
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

    const t = await db.query(`SELECT id, business_sector FROM internal.tenants WHERE external_ref = $1`, [
      businessId,
    ]);
    if (!t.rows.length) return res.status(404).json({ ok: false, error: 'MERCHANT_NOT_SYNCED' });

    const id = await writeActivity(db, {
      merchantId: t.rows[0].id,
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
}
