type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';
import { ENTITLEMENT_DARURAT, TANPA_BATAS } from '../../../src/lib/plans/entitlements.js';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    // SSL wajib untuk database terkelola, dan mustahil untuk yang lokal —
    // Postgres di localhost menolak dengan "server does not support SSL".
    // Memaksanya membuat endpoint ini tidak bisa dijalankan atau diuji di mesin
    // sendiri sama sekali.
    const url = process.env.DATABASE_URL || '';
    const lokal = /@(127\.0\.0\.1|localhost)|host=\//.test(url);

    pool = new pg.Pool({
      connectionString: url,
      ssl: lokal ? undefined : { rejectUnauthorized: false },
      max: Number(process.env.PGPOOL_MAX || 2),
    });
  }
  return pool;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const body = req.body ?? {};
  const { businessId, sector, storeName, ownerRef, idempotencyKey, transactions } = body;
  const txns = Array.isArray(transactions) ? transactions : [];

  if (!businessId || !sector) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', detail: 'businessId and sector are required' });
  }

  const db = getPool();
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // 1. Ensure Tenant, keyed on external_ref.
    // This is the same key services/shared/identity.ts resolves through
    // (contract.merchant_directory.client_key). Keying on legacy_uuid(id)
    // instead produced a tenant that resolveTenant could never find, so the
    // AI wallet and the subscription attached to a different merchant than
    // the transactions did.
    const tenantRes = await client.query(
      `INSERT INTO pos.businesses (id, name, business_sector, client_key, owner_user_ref, is_active)
       VALUES (uuidv7(), $1, $2, $3, $4, true)
       ON CONFLICT (client_key) WHERE client_key IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name, business_sector = EXCLUDED.business_sector
       RETURNING id`,
      [storeName || 'New Hope Store', sector, businessId, ownerRef || null]
    );
    const tenantId = tenantRes.rows[0].id;

    // 2. Ensure the cashier this batch is attributed to.
    const cashierName = String(txns.find((t: any) => t.cashierName)?.cashierName || 'Kasir');
    const cashierRef = ownerRef || 'usr-1';
    const userRes = await client.query(
      `INSERT INTO pos.users (id, business_id, name, username, pin, role, external_ref)
       VALUES (uuidv7(), $1, $2, $3, '----', 'ADMIN', $4)
       ON CONFLICT (business_id, external_ref) WHERE external_ref IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [tenantId, cashierName.slice(0, 100), `${businessId}.${cashierRef}`.slice(0, 50), cashierRef]
    );
    const defaultUserId = userRes.rows[0].id;

    // 2b. BATAS PRODUK PAKET — ditegakkan DI SINI, bukan hanya di aplikasi kasir.
    //
    // Penegakan di klien bisa dilewati siapa pun yang mengirim POST sendiri ke
    // endpoint ini. Diuji dan terbukti sebelum perbaikan ini: merchant paket
    // Free (batas 30) mengirim 40 produk lewat sinkron, dan keempat puluhnya
    // masuk katalog.
    //
    // Tanpa baris langganan, yang dipakai batas darurat yang sama dengan
    // aplikasi kasir — bukan "tanpa batas". Merchant yang belum berlangganan
    // bukan merchant dengan paket termahal.
    const batasRes = await client.query(
      `SELECT product_limit FROM contract.merchant_entitlements WHERE business_id = $1`,
      [tenantId]
    );
    const batasProduk = batasRes.rows.length
      ? Number(batasRes.rows[0].product_limit)
      : ENTITLEMENT_DARURAT.productLimit;

    const jumlahRes = await client.query(
      `SELECT COUNT(*)::int AS n FROM pos.products WHERE business_id = $1`,
      [tenantId]
    );
    let jumlahProduk = jumlahRes.rows[0].n as number;
    let katalogDitahan = 0;

    // 3. Resolve catalog rows on demand, matched on external_ref.
    // Cached per request: a busy day sends the same drink on dozens of receipts.
    const productIds = new Map<string, string>();

    const resolveProduct = async (item: any): Promise<string | null> => {
      const ref = String(item.productRef || item.productName || '').slice(0, 96);
      if (!ref) return null;
      if (productIds.has(ref)) return productIds.get(ref)!;

      const found = await client.query(
        `SELECT id FROM pos.products
          WHERE business_id = $1 AND (external_ref = $2 OR name = $3) LIMIT 1`,
        [tenantId, ref, item.productName]
      );

      let id: string;
      if (found.rows.length) {
        id = found.rows[0].id;
      } else {
        // KATALOG PENUH: barisnya tetap masuk, produknya tidak.
        //
        // Uang yang sudah diterima merchant TIDAK BOLEH hilang karena batas
        // paket — menolak transaksinya berarti omzet hari itu tidak pernah
        // tercatat, dan itu kerugian yang jauh lebih besar daripada satu baris
        // katalog. product_id boleh NULL dan product_name disalin pada baris
        // struk, jadi nama, jumlah, dan nilainya tetap utuh di laporan.
        //
        // Yang tidak didapat merchant adalah produknya masuk katalog: tidak
        // muncul di daftar barang, tidak ikut laporan per-produk, tidak bisa
        // diatur stoknya. Itulah yang dijual paket berikutnya.
        if (batasProduk !== TANPA_BATAS && jumlahProduk >= batasProduk) {
          katalogDitahan++;
          return null;
        }

        // A product sold but never present in the catalog sync still has to
        // land, or the receipt line is lost along with its revenue.
        const ins = await client.query(
          `INSERT INTO pos.products
             (id, business_id, name, sku, price, cost_price, business_sector,
              client_key, category_name, description, external_ref)
           VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            tenantId,
            String(item.productName || ref).slice(0, 100),
            ref.slice(0, 50),
            Number(item.unitPrice) || 0,
            Number(item.unitCost) || 0,
            sector,
            businessId,
            item.categoryName || 'General',
            item.productDescription || null,
            ref,
          ]
        );
        id = ins.rows[0].id;
        jumlahProduk++;
      }

      productIds.set(ref, id);
      return id;
    };

    // 4. Ensure Customers referenced by this batch.
    // Matched on external_ref like products and staff, never on name or phone.
    // Loyalty figures are overwritten, not accumulated: a replayed batch would
    // otherwise double every member's lifetime spend.
    const customerIds = new Map<string, string>();
    const TIERS = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];

    for (const t of txns) {
      const c = t.customer;
      if (!c?.ref || !c?.name || customerIds.has(c.ref)) continue;

      const tier = String(c.tier || '').toUpperCase();
      const custRes = await client.query(
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
           updated_at    = CURRENT_TIMESTAMP
         RETURNING id`,
        [
          tenantId,
          String(c.ref).slice(0, 96),
          String(c.name).slice(0, 100),
          c.phone ? String(c.phone).slice(0, 32) : null,
          c.email ? String(c.email).slice(0, 160) : null,
          Math.max(0, Math.trunc(Number(c.points) || 0)),
          Math.max(0, Number(c.totalSpent) || 0),
          Math.max(0, Math.trunc(Number(c.visitCount) || 0)),
          TIERS.includes(tier) ? tier : 'BRONZE',
          c.lastVisitAt || null,
          sector,
          businessId,
        ]
      );
      customerIds.set(c.ref, custRes.rows[0].id);
    }

    /*
     * PENULISAN MASSAL, bukan satu kueri per baris.
     *
     * Bentuk sebelumnya mengirim sekitar 2 + jumlah-item kueri UNTUK SETIAP
     * transaksi: cek duplikat, ambil uuid, insert transaksi, lalu satu insert
     * per baris struk. Satu batch penuh (200 transaksi x 3 item) menjadi
     * ~1010 perjalanan bolak-balik ke database DALAM SATU PERMINTAAN.
     *
     * Di localhost itu 283 ms dan terasa cepat. Di Postgres terkelola dengan
     * RTT 2–5 ms, angka yang sama menjadi 2–5 DETIK — mepet batas 10 detik
     * fungsi serverless. Dan karena seluruhnya satu transaksi, timeout berarti
     * rollback penuh: merchant mengirim ulang selamanya tanpa pernah berhasil,
     * sementara omzetnya tidak pernah tercatat.
     *
     * Sekarang: satu kueri untuk memeriksa SEMUA duplikat, satu untuk semua
     * transaksi, satu untuk semua baris item. Tiga perjalanan, bukan seribu.
     */
    let accepted = 0;
    let duplicates = 0;

    const berid = txns.filter((t: any) => t.clientTxnId);

    // 1. Duplikat diperiksa sekali untuk seluruh batch.
    const sudahAda = new Set<string>();
    if (berid.length) {
      const { rows } = await client.query(
        `SELECT client_txn_id FROM pos.transactions
          WHERE business_id = $1 AND client_txn_id = ANY($2::text[])`,
        [tenantId, berid.map((t: any) => String(t.clientTxnId))]
      );
      for (const r of rows) sudahAda.add(r.client_txn_id);
    }

    // Kiriman yang sama bisa memuat clientTxnId kembar di dalam dirinya
    // sendiri. Tanpa penjagaan ini, INSERT massal menabrak unique constraint
    // dan MENGGAGALKAN SELURUH BATCH — termasuk transaksi yang tidak
    // bersalah.
    const dalamBatch = new Set<string>();
    const baru: any[] = [];
    for (const t of berid) {
      const kunci = String(t.clientTxnId);
      if (sudahAda.has(kunci) || dalamBatch.has(kunci)) {
        duplicates++;
        continue;
      }
      dalamBatch.add(kunci);
      baru.push(t);
    }

    if (baru.length) {
      // 2. Produk diresolusi lebih dulu supaya loop insert tidak menyentuh
      //    database sama sekali. resolveProduct sudah menyimpan hasilnya, jadi
      //    produk yang sama pada puluhan struk hanya dicari satu kali.
      const idProduk = new Map<any, string | null>();
      for (const t of baru) {
        if (!Array.isArray(t.items)) continue;
        for (const item of t.items) idProduk.set(item, await resolveProduct(item));
      }

      // 3. Satu INSERT untuk semua transaksi.
      const kolomTxn = 18;
      const nilaiTxn: any[] = [];
      const barisTxn: string[] = [];
      // Seluruh id dibangkitkan dalam SATU kueri. Memanggil uuidv7() sekali per
      // transaksi mengembalikan N perjalanan yang baru saja dihilangkan.
      const { rows: idRows } = await client.query(
        'SELECT uuidv7() AS id FROM generate_series(1, $1)',
        [baru.length]
      );
      const idTxn: string[] = idRows.map((r: any) => r.id);

      baru.forEach((t: any, i: number) => {
        const p = i * kolomTxn;
        barisTxn.push(
          `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, ` +
          `$${p + 8}, $${p + 9}, $${p + 10}, $${p + 11}, $${p + 12}, $${p + 13}, $${p + 14}, ` +
          `$${p + 15}, $${p + 16}, $${p + 17}, COALESCE($${p + 18}::timestamptz, CURRENT_TIMESTAMP))`
        );
        nilaiTxn.push(
          idTxn[i],
          t.clientTxnId,
          tenantId,
          defaultUserId,
          t.customer?.ref ? customerIds.get(t.customer.ref) ?? null : null,
          t.invoiceNumber || `INV-${Date.now()}-${i}`,
          Number(t.subtotal) || 0,
          Number(t.discountAmount) || 0,
          Number(t.taxAmount) || 0,
          Number(t.serviceChargeAmount) || 0,
          Number(t.totalAmount) || 0,
          t.paymentMethod || 'CASH',
          t.paymentStatus || 'COMPLETED',
          t.orderType || 'DINE_IN',
          t.appModule || 'POS',
          sector,
          businessId,
          t.createdAt || null
        );
      });

      // cashier_name / cashier_role BUKAN kolom di sini — nama kasir dijangkau
      // lewat cashier_user_id, dan contract.transaction_log yang menggabungkannya.
      await client.query(
        `INSERT INTO pos.transactions (
           id, client_txn_id, business_id, cashier_user_id, customer_id,
           invoice_number, subtotal, discount_amount, tax_amount, service_charge_amount,
           total_amount, payment_method, payment_status, order_type, app_module,
           business_sector, client_key, created_at
         ) VALUES ${barisTxn.join(', ')}`,
        nilaiTxn
      );

      // 4. Satu INSERT untuk semua baris struk.
      const kolomItem = 11;
      const nilaiItem: any[] = [];
      const barisItem: string[] = [];

      baru.forEach((t: any, i: number) => {
        if (!Array.isArray(t.items)) return;
        for (const item of t.items) {
          const p = nilaiItem.length;
          barisItem.push(
            `(uuidv7(), $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, ` +
            `$${p + 7}, $${p + 8}, $${p + 9}, $${p + 10}, $${p + 11})`
          );
          const quantity = Math.max(1, Math.trunc(Number(item.quantity) || 1));
          nilaiItem.push(
            idTxn[i],
            tenantId,
            idProduk.get(item) ?? null,
            item.productName,
            item.productDescription || '',
            item.categoryName || 'General',
            Number(item.unitPrice) || 0,
            Number(item.unitCost) || 0,
            quantity,
            Number(item.totalPrice) || (Number(item.unitPrice) || 0) * quantity,
            sector
          );
        }
      });

      if (barisItem.length) {
        await client.query(
          `INSERT INTO pos.transaction_items (
             id, transaction_id, business_id, product_id, product_name, product_description,
             category_name, unit_price, unit_cost, quantity, total_price, business_sector
           ) VALUES ${barisItem.join(', ')}`,
          nilaiItem
        );
      }

      accepted = baru.length;
    }

    // Log sync receipt. idempotency_key is the primary key — there is no
    // separate id column, and the timestamp is received_at.
    if (idempotencyKey) {
      await client.query(
        `INSERT INTO pos.sync_receipts
           (idempotency_key, business_id, client_key, rows_accepted, rows_duplicate)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [idempotencyKey, tenantId, businessId, accepted, duplicates]
      );
    }

    await client.query('COMMIT');

    return res.status(200).json({
      ok: true,
      accepted,
      duplicates,
      tenantId,
      // Dilaporkan, tidak didiamkan. Merchant harus tahu ada barang yang
      // terjual tapi tidak masuk katalognya, berikut alasannya — batas yang
      // ditegakkan diam-diam hanya menghasilkan laporan yang terasa salah
      // tanpa ada yang tahu sebabnya.
      catalogSkipped: katalogDitahan,
      productLimit: batasProduk,
      message: katalogDitahan > 0
        ? `Transaksi tersimpan. ${katalogDitahan} produk tidak masuk katalog karena batas paket (${batasProduk} produk) sudah tercapai.`
        : 'Transactions synced successfully to Supabase',
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[API Sync Transactions Error]:', err);
    return res.status(500).json({ ok: false, error: 'SYNC_FAILED', detail: err.message });
  } finally {
    client.release();
  }
}
