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
 *   - tenants / staff / products  -> dicocokkan lewat kode (client_key,
 *                                    employee_code, external_ref)
 *   - transactions                -> UNIQUE (business_id, client_txn_id)
 *   - seluruh batch               -> sync_receipts.idempotency_key
 *
 * Menghitung omzet dua kali adalah kerusakan yang tidak bisa diperbaiki lewat
 * layar mana pun, jadi pertahanannya berlapis dan sengaja berlebihan.
 */

import type express from 'express';
import type { Db } from '../shared/db';
import { SECTORS, writeActivity, type Sector } from './activity';
import { pastikanStaf } from '../../src/lib/staf/resolusi';

const SECTOR_SET = new Set<string>(SECTORS);
const MAX_BATCH = 500;

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

interface SyncCustomer {
  ref: string;
  name: string;
  phone?: string;
  email?: string;
  points?: number;
  tier?: string;
  totalSpent?: number;
  visitCount?: number;
  lastVisitAt?: string;
}

const TIERS = new Set(['BRONZE', 'SILVER', 'GOLD', 'PLATINUM']);

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
  appModule?: string;
  createdAt?: string;
  customer?: SyncCustomer;
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
    // businessId berbentuk `${userId}_${sector}`, jadi pemiliknya selalu bisa
    // diturunkan darinya. Tanpa turunan ini, kiriman yang lupa ownerRef
    // melahirkan unit usaha TANPA merchant — dan trigger yang membuat merchant
    // beserta langganan trialnya melewatinya diam-diam.
    const ownerRef = str(body.ownerRef, 64) ?? (businessId ? businessId.split('_')[0] : null);
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

        /* -- MERCHANT ------------------------------------------------------ */
        // client_key (`${userId}_${sector}`) adalah partition key dari
        // TenantContext. Satu pemilik dengan kafe DAN laundry menghasilkan dua
        // baris tenants, yang memang benar: keduanya usaha terpisah.
        const t = await c.query(
          `INSERT INTO pos.businesses (id, name, business_sector, client_key, owner_user_ref)
           VALUES (uuidv7(), $1, $2, $3, $4)
           ON CONFLICT (client_key) WHERE client_key IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [storeName, sector, businessId, ownerRef]
        );
        const tenantId: string = t.rows[0].id;

        /* -- STAF & PRODUK -------------------------------------------------- */
        const cashierCache = new Map<string, string>();
        const productCache = new Map<string, string>();

        // Sejak 0033, keduanya lewat satu jalur yang sama — dulu salinan di sini
        // menulis peran dari perangkat sementara salinan di api/v1/sync menulis
        // 'ADMIN', untuk kejadian yang sama.
        const resolveCashier = async (ref: string | null, name: string | null, role: string | null) => {
          const key = ref || name;
          if (!key) return null;
          if (cashierCache.has(key)) return cashierCache.get(key)!;

          const id = await pastikanStaf(c, {
            businessId: tenantId,
            employeeCode: ref,
            name,
            role,
          });
          if (!id) return null;
          cashierCache.set(key, id);
          return id;
        };

        /**
         * Member toko. Dicocokkan lewat external_ref, sama seperti staf dan
         * produk — bukan lewat nama atau nomor telepon, yang keduanya berubah.
         *
         * Angka loyalitas ditimpa apa adanya dari perangkat kasir. Menjumlahkan
         * di server akan menggandakan total belanja pada setiap kiriman ulang,
         * dan kiriman ulang adalah kejadian normal di sini.
         */
        const customerCache = new Map<string, string>();

        const resolveCustomer = async (cust: SyncCustomer | undefined) => {
          const ref = str(cust?.ref, 96);
          const name = str(cust?.name, 100);
          if (!cust || !ref || !name) return null;
          if (customerCache.has(ref)) return customerCache.get(ref)!;

          const tier = String(cust.tier ?? '').toUpperCase();
          const ins = await c.query(
            `INSERT INTO pos.customers
               (id, business_id, external_ref, name, phone, email, points, total_spent,
                visit_count, tier, last_visit_at, business_sector, client_key)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12)
             ON CONFLICT (business_id, external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET
               name          = EXCLUDED.name,
               phone         = COALESCE(EXCLUDED.phone, pos.customers.phone),
               email         = COALESCE(EXCLUDED.email, pos.customers.email),
               points        = EXCLUDED.points,
               total_spent   = EXCLUDED.total_spent,
               visit_count   = EXCLUDED.visit_count,
               tier          = EXCLUDED.tier,
               last_visit_at = GREATEST(
                                 EXCLUDED.last_visit_at,
                                 pos.customers.last_visit_at
                               ),
               updated_at    = CURRENT_TIMESTAMP
             RETURNING id`,
            [
              tenantId,
              ref,
              name,
              str(cust.phone, 32),
              str(cust.email, 160),
              Math.max(0, Math.trunc(num(cust.points))),
              Math.max(0, num(cust.totalSpent)),
              Math.max(0, Math.trunc(num(cust.visitCount))),
              TIERS.has(tier) ? tier : 'BRONZE',
              cust.lastVisitAt ?? null,
              sector,
              businessId,
            ]
          );
          const id: string = ins.rows[0].id;
          customerCache.set(ref, id);
          return id;
        };

        const resolveProduct = async (i: SyncItem) => {
          const key = i.productRef || i.productName;
          if (!key) return null;
          if (productCache.has(key)) return productCache.get(key)!;

          const found = await c.query(
            `SELECT id FROM pos.products WHERE business_id = $1 AND (external_ref = $2 OR name = $3) LIMIT 1`,
            [tenantId, i.productRef ?? null, i.productName]
          );
          let id: string;
          if (found.rows.length) {
            id = found.rows[0].id;
          } else {
            const ins = await c.query(
              `INSERT INTO pos.products (id, business_id, name, sku, price, cost_price,
                                     business_sector, client_key, category_name,
                                     description, external_ref)
               VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
              [
                tenantId,
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

          const customerId = await resolveCustomer(x.customer);

          const ins = await c.query(
            `INSERT INTO pos.transactions
               (id, business_id, cashier_user_id, customer_id, subtotal, discount_amount,
                tax_amount, service_charge_amount, total_amount, payment_method,
                payment_status, business_sector, client_key, app_module, order_type,
                invoice_number, client_txn_id, created_at)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                     $16, COALESCE($17::timestamptz, CURRENT_TIMESTAMP))
             ON CONFLICT (business_id, client_txn_id) WHERE client_txn_id IS NOT NULL
               DO NOTHING
             RETURNING id`,
            [
              tenantId,
              cashierId,
              customerId,
              subtotal,
              discount,
              tax,
              serviceCharge,
              total,
              str(x.paymentMethod, 20) ?? 'CASH',
              str(x.paymentStatus, 20) ?? 'COMPLETED',
              sector,
              businessId,
              appModule,
              str(x.orderType, 16),
              str(x.invoiceNumber, 64),
              clientId,
              x.createdAt ?? null,
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
                    SET payment_status = 'CANCELLED'
                  WHERE business_id = $1 AND client_txn_id = $2
                    AND payment_status <> 'CANCELLED'
                RETURNING id`,
                [tenantId, clientId]
              );
              if (upd.rows.length) {
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
                  transactionId: upd.rows[0].id,
                  amountIdr: total,
                  summary: `Transaksi ${str(x.invoiceNumber, 64) ?? clientId} dibatalkan`,
                  detail: { clientTxnId: clientId },
                });
              }
            }
            continue;
          }

          const txnId: string = ins.rows[0].id;
          for (const i of x.items) {
            const productId = await resolveProduct(i);
            if (!productId) continue;
            const qty = Math.max(1, Math.trunc(num(i.quantity, 1)));
            await c.query(
              `INSERT INTO pos.transaction_items
                 (id, transaction_id, business_id, product_id, product_name, unit_price,
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
          }
          accepted++;
        }

        if (idemKey) {
          await c.query(
            `INSERT INTO pos.sync_receipts (idempotency_key, business_id, client_key,
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
    // businessId berbentuk `${userId}_${sector}`, jadi pemiliknya selalu bisa
    // diturunkan darinya. Tanpa turunan ini, kiriman yang lupa ownerRef
    // melahirkan unit usaha TANPA merchant — dan trigger yang membuat merchant
    // beserta langganan trialnya melewatinya diam-diam.
    const ownerRef = str(b.ownerRef, 64) ?? (businessId ? businessId.split('_')[0] : null);
    const products: any[] = Array.isArray(b.products) ? b.products : [];
    const pelanggan: any[] = Array.isArray(b.customers) ? b.customers : [];
    const bundel: any[] = Array.isArray(b.bundles) ? b.bundles : [];

    if (!businessId || !sector || !SECTOR_SET.has(sector)) {
      return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
    }
    if (products.length > 2000) {
      return res.status(413).json({ ok: false, error: 'CATALOG_TOO_LARGE' });
    }

    try {
      const out = await db.tx(async (c) => {
        const t = await c.query(
          `INSERT INTO pos.businesses (id, name, business_sector, client_key, owner_user_ref)
           VALUES (uuidv7(), $1, $2, $3, $4)
           ON CONFLICT (client_key) WHERE client_key IS NOT NULL
             DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [storeName, sector, businessId, ownerRef]
        );
        const tenantId: string = t.rows[0].id;
        const seen: string[] = [];
        let upserted = 0;

        for (const p of products) {
          const ref = str(p.id, 96);
          const name = str(p.name, 100);
          if (!ref || !name) continue;
          seen.push(ref);

          await c.query(
            `INSERT INTO pos.products
               (id, business_id, name, sku, price, cost_price, is_available,
                business_sector, client_key, category_name, description,
                stock, min_stock_alert, unit, external_ref, catalog_synced_at)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                     CURRENT_TIMESTAMP)
             ON CONFLICT (business_id, external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET
               name              = EXCLUDED.name,
               sku               = EXCLUDED.sku,
               price             = EXCLUDED.price,
               cost_price        = EXCLUDED.cost_price,
               is_available      = EXCLUDED.is_available,
               category_name     = EXCLUDED.category_name,
               description       = EXCLUDED.description,
               stock             = EXCLUDED.stock,
               min_stock_alert   = EXCLUDED.min_stock_alert,
               unit              = EXCLUDED.unit,
               catalog_synced_at = CURRENT_TIMESTAMP`,
            [
              tenantId,
              name,
              str(p.sku, 50) ?? ref,
              num(p.price),
              num(p.costPrice),
              p.isAvailable !== false,
              sector,
              businessId,
              str(p.categoryName, 100),
              str(p.description, 300),
              num(p.stock),
              num(p.minStockAlert),
              str(p.unit, 20),
              ref,
            ]
          );
          upserted++;
        }

        /* -- MEMBER ---------------------------------------------------------
         *
         * Dikirim bersama katalog, bukan hanya saat bertransaksi. Sebelumnya
         * baris pelanggan lahir dari pembelian pertama, jadi member yang sudah
         * didaftarkan tapi belum pernah belanja tidak pernah sampai ke server —
         * dan justru merekalah yang paling ingin dihubungi merchant.
         */
        let membersUpserted = 0;
        for (const cst of pelanggan) {
          const ref = str(cst?.id, 96);
          const nama = str(cst?.name, 100);
          if (!ref || !nama) continue;

          const tier = String(cst?.tier ?? '').toUpperCase();
          await c.query(
            `INSERT INTO pos.customers
               (id, business_id, external_ref, name, phone, email, points, total_spent,
                visit_count, tier, last_visit_at, business_sector, client_key)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12)
             ON CONFLICT (business_id, external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET
               name          = EXCLUDED.name,
               phone         = COALESCE(EXCLUDED.phone, pos.customers.phone),
               email         = COALESCE(EXCLUDED.email, pos.customers.email),
               points        = EXCLUDED.points,
               total_spent   = EXCLUDED.total_spent,
               visit_count   = EXCLUDED.visit_count,
               tier          = EXCLUDED.tier,
               last_visit_at = GREATEST(EXCLUDED.last_visit_at, pos.customers.last_visit_at),
               updated_at    = CURRENT_TIMESTAMP`,
            [
              tenantId, ref, nama,
              str(cst?.phone, 32), str(cst?.email, 160),
              Math.max(0, Math.trunc(num(cst?.points))),
              Math.max(0, num(cst?.totalSpent)),
              Math.max(0, Math.trunc(num(cst?.visitCount))),
              TIERS.has(tier) ? tier : 'BRONZE',
              cst?.lastVisit ?? null,
              sector, businessId,
            ]
          );
          membersUpserted++;
        }

        /* -- BUNDLE PROMO ---------------------------------------------------
         *
         * Isi paket ditulis ulang seluruhnya setiap kiriman, bukan di-diff.
         * Alasannya sama dengan katalog: melacak perubahan menuntut jurnal yang
         * belum ada, dan jurnal yang meleset sekali menghasilkan paket yang
         * berbeda selamanya tanpa ada yang menyadari.
         */
        let bundlesUpserted = 0;
        for (const bd of bundel) {
          const ref = str(bd?.id, 96);
          const nama = str(bd?.name, 100);
          if (!ref || !nama) continue;

          const ins = await c.query(
            `INSERT INTO pos.bundles
               (id, business_id, external_ref, name, sku, description, regular_price,
                bundle_price, is_available, business_sector, client_key)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (business_id, external_ref) WHERE external_ref IS NOT NULL
             DO UPDATE SET
               name          = EXCLUDED.name,
               sku           = EXCLUDED.sku,
               description   = EXCLUDED.description,
               regular_price = EXCLUDED.regular_price,
               bundle_price  = EXCLUDED.bundle_price,
               is_available  = EXCLUDED.is_available,
               updated_at    = CURRENT_TIMESTAMP
             RETURNING id`,
            [
              tenantId, ref, nama,
              str(bd?.sku, 50), str(bd?.description, 300),
              num(bd?.regularPrice), num(bd?.bundlePrice),
              bd?.isAvailable !== false, sector, businessId,
            ]
          );
          const bundleId: string = ins.rows[0].id;

          await c.query(`DELETE FROM pos.bundle_items WHERE bundle_id = $1`, [bundleId]);
          for (const it of Array.isArray(bd?.items) ? bd.items : []) {
            const namaItem = str(it?.productName, 100);
            if (!namaItem) continue;
            const qty = Math.max(1, Math.trunc(num(it?.quantity, 1)));
            await c.query(
              `INSERT INTO pos.bundle_items
                 (id, bundle_id, business_id, product_id, product_name, quantity,
                  unit_price, subtotal_price)
               VALUES (uuidv7(), $1, $2,
                       (SELECT id FROM pos.products
                         WHERE business_id = $2 AND external_ref = $3 LIMIT 1),
                       $4, $5, $6, $7)`,
              [
                bundleId, tenantId, str(it?.productId, 96), namaItem, qty,
                num(it?.unitPrice), num(it?.subtotalPrice, num(it?.unitPrice) * qty),
              ]
            );
          }
          bundlesUpserted++;
        }

        // Produk yang tidak ada lagi di perangkat: disembunyikan, bukan dibuang.
        let retired = 0;
        if (seen.length > 0) {
          const r = await c.query(
            `UPDATE pos.products
                SET is_available = FALSE
              WHERE business_id = $1
                AND external_ref IS NOT NULL
                AND NOT (external_ref = ANY($2::text[]))
                AND is_available
              RETURNING id`,
            [tenantId, seen]
          );
          retired = r.rows.length;
        }

        return { tenantId, upserted, retired, membersUpserted, bundlesUpserted };
      });

      res.json({ ok: true, ...out });
    } catch (err) {
      console.error('[sync] katalog gagal:', (err as Error).message);
      res.status(500).json({ ok: false, error: 'CATALOG_SYNC_FAILED' });
    }
  });

  /** Kejadian non-penjualan dari aplikasi kasir. */
  app.post('/api/v1/sync/activity', async (req, res) => {
    const b = req.body ?? {};
    const businessId = str(b.businessId, 96);
    if (!businessId) return res.status(400).json({ ok: false, error: 'BUSINESS_ID_REQUIRED' });

    const t = await db.query(`SELECT id, business_sector FROM pos.businesses WHERE client_key = $1`, [
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

    const { rows } = await db.query(
      `SELECT t.id, t.name, t.business_sector,
              COUNT(x.id)::int              AS synced_transactions,
              COALESCE(SUM(x.total_amount), 0) AS synced_revenue,
              MAX(x.created_at)             AS last_transaction_at
         FROM pos.businesses t
         LEFT JOIN pos.transactions x ON x.business_id = t.id
        WHERE t.client_key = $1
        GROUP BY t.id, t.name, t.business_sector`,
      [businessId]
    );

    if (!rows.length) return res.json({ ok: true, synced: false });
    res.json({ ok: true, synced: true, ...rows[0] });
  });
}
