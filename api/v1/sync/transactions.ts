type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
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

    // 1. Ensure Tenant
    const tenantRes = await client.query(
      `INSERT INTO pos.tenants (id, name, business_sector, is_active)
       VALUES (legacy_uuid($1), $2, $3, true)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, business_sector = EXCLUDED.business_sector
       RETURNING id`,
      [businessId, storeName || 'New Hope Store', sector]
    );
    const tenantId = tenantRes.rows[0].id;

    // 2. Ensure User / Cashier
    const userRes = await client.query(
      `INSERT INTO pos.users (id, tenant_id, name, username, pin, role)
       VALUES (legacy_uuid($1), $2, $3, $4, '1234', 'ADMIN')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [ownerRef || 'usr-1', tenantId, 'Budi Santoso', 'budi.admin']
    );
    const defaultUserId = userRes.rows[0].id;

    let accepted = 0;
    let duplicates = 0;

    for (const t of txns) {
      if (!t.clientTxnId) continue;

      // Check if already exists
      const existing = await client.query(
        `SELECT id FROM pos.transactions WHERE client_txn_id = $1 AND tenant_id = $2`,
        [t.clientTxnId, tenantId]
      );

      if (existing.rows.length > 0) {
        duplicates++;
        continue;
      }

      const txnId = await client.query('SELECT uuidv7() as id');
      const realTxnId = txnId.rows[0].id;

      await client.query(
        `INSERT INTO pos.transactions (
          id, client_txn_id, tenant_id, cashier_user_id, cashier_name, cashier_role,
          invoice_number, subtotal, discount_amount, tax_amount, service_charge_amount,
          total_amount, payment_method, payment_status, order_type, app_module, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, COALESCE($17::timestamptz, CURRENT_TIMESTAMP)
        )`,
        [
          realTxnId,
          t.clientTxnId,
          tenantId,
          defaultUserId,
          t.cashierName || 'Budi Santoso',
          t.cashierRole || 'ADMIN',
          t.invoiceNumber || `INV-${Date.now()}`,
          Number(t.subtotal) || 0,
          Number(t.discountAmount) || 0,
          Number(t.taxAmount) || 0,
          Number(t.serviceChargeAmount) || 0,
          Number(t.totalAmount) || 0,
          t.paymentMethod || 'CASH',
          t.paymentStatus || 'COMPLETED',
          t.orderType || 'DINE_IN',
          t.appModule || 'POS',
          t.createdAt || null,
        ]
      );

      if (Array.isArray(t.items)) {
        for (const item of t.items) {
          await client.query(
            `INSERT INTO pos.transaction_items (
              id, transaction_id, tenant_id, product_id, product_name, product_description,
              category_name, unit_price, unit_cost, quantity, total_price
            ) VALUES (
              uuidv7(), $1, $2, legacy_uuid($3), $4, $5, $6, $7, $8, $9, $10
            )`,
            [
              realTxnId,
              tenantId,
              item.productRef || item.productName,
              item.productName,
              item.productDescription || '',
              item.categoryName || 'General',
              Number(item.unitPrice) || 0,
              Number(item.unitCost) || 0,
              Number(item.quantity) || 1,
              Number(item.totalPrice) || (Number(item.unitPrice) * Number(item.quantity)),
            ]
          );
        }
      }

      accepted++;
    }

    // Log sync receipt
    if (idempotencyKey) {
      await client.query(
        `INSERT INTO pos.sync_receipts (id, tenant_id, idempotency_key, rows_accepted, rows_duplicate, created_at)
         VALUES (uuidv7(), $1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [tenantId, idempotencyKey, accepted, duplicates]
      );
    }

    await client.query('COMMIT');

    return res.status(200).json({
      ok: true,
      accepted,
      duplicates,
      tenantId,
      message: 'Transactions synced successfully to Supabase',
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[API Sync Transactions Error]:', err);
    return res.status(500).json({ ok: false, error: 'SYNC_FAILED', detail: err.message });
  } finally {
    client.release();
  }
}
