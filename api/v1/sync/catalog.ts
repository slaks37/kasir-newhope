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
  const { businessId, sector, storeName, ownerRef, products } = body;
  const prods = Array.isArray(products) ? products : [];

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

    // 2. Upsert Products
    for (const p of prods) {
      if (!p.name) continue;
      await client.query(
        `INSERT INTO pos.products (
          id, tenant_id, name, sku, price, cost_price, is_available, description
        ) VALUES (
          legacy_uuid($1), $2, $3, $4, $5, $6, $7, $8
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          sku = EXCLUDED.sku,
          price = EXCLUDED.price,
          cost_price = EXCLUDED.cost_price,
          is_available = EXCLUDED.is_available,
          description = EXCLUDED.description`,
        [
          p.id || `prod-${p.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          tenantId,
          p.name,
          p.sku || `SKU-${Date.now()}`,
          Number(p.price) || 0,
          Number(p.costPrice) || 0,
          p.isAvailable ?? true,
          p.description || '',
        ]
      );
    }

    await client.query('COMMIT');

    return res.status(200).json({
      ok: true,
      synced: prods.length,
      tenantId,
      message: 'Catalog synced successfully to Supabase',
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[API Sync Catalog Error]:', err);
    return res.status(500).json({ ok: false, error: 'CATALOG_SYNC_FAILED', detail: err.message });
  } finally {
    client.release();
  }
}
