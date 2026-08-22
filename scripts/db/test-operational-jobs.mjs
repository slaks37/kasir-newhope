import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  console.log('--- Testing Deferred Operational Job Consumption Engine ---');

  // 1. Get outlet for Laundry
  const mRes = await client.query("SELECT m.id AS merchant_id, m.tenant_id, o.id AS outlet_id, l.id AS location_id FROM internal.merchants m JOIN internal.outlets o ON o.merchant_id = m.id LEFT JOIN pos.inventory_locations l ON l.outlet_id = o.id WHERE m.business_sector = 'LAUNDRY' LIMIT 1");
  const ctx = mRes.rows[0];

  // Create Deterjen Cair in inventory
  const detItem = (await client.query(`
    INSERT INTO pos.inventory_items (tenant_id, merchant_id, sku, item_name, base_unit, cost_per_unit, item_type)
    VALUES ($1, $2, 'RM-DET-CONC-01', 'Deterjen Cair Konsentrat Pro', 'ml', 0.05, 'RAW_MATERIAL')
    ON CONFLICT (merchant_id, sku) DO UPDATE SET item_name = EXCLUDED.item_name
    RETURNING id
  `, [ctx.tenant_id, ctx.merchant_id])).rows[0].id;

  // Set initial balance
  await client.query(`
    INSERT INTO pos.inventory_balances (tenant_id, merchant_id, outlet_id, location_id, inventory_item_id, current_stock)
    VALUES ($1, $2, $3, $4, $5, 10000.0)
    ON CONFLICT (outlet_id, location_id, inventory_item_id) DO UPDATE SET current_stock = 10000.0
  `, [ctx.tenant_id, ctx.merchant_id, ctx.outlet_id, ctx.location_id, detItem]);

  const stockBefore = (await client.query("SELECT current_stock FROM pos.inventory_balances WHERE inventory_item_id = $1 AND outlet_id = $2", [detItem, ctx.outlet_id])).rows[0].current_stock;
  console.log('1. Saldo Deterjen Awal:', stockBefore, 'ml');

  // Create Drop-off Transaction
  const tx = (await client.query(`
    INSERT INTO pos.transactions (tenant_id, merchant_id, outlet_id, invoice_number, order_status, subtotal, tax_amount, total_amount, payment_method, business_sector)
    VALUES ($1, $2, $3, 'INV-LD-DEFER-001', 'OPEN', 40000, 4000, 44000, 'CASH', 'LAUNDRY')
    RETURNING id
  `, [ctx.tenant_id, ctx.merchant_id, ctx.outlet_id])).rows[0].id;

  await client.query(`
    INSERT INTO pos.order_context_laundry (transaction_id, weight_kg, fragrance_name, operational_status)
    VALUES ($1, 5.0, 'Lavender Aromatherapy', 'RECEIVED')
  `, [tx]);

  // Create SPK / Work Order in QUEUED state
  const jobId = (await client.query(`
    INSERT INTO pos.operational_jobs (tenant_id, merchant_id, outlet_id, transaction_id, job_type, job_number, resource_name, status)
    VALUES ($1, $2, $3, $4, 'LAUNDRY_CYCLE', 'SPK-WASH-001', 'Mesin Cuci LG Front-Load #02', 'QUEUED')
    RETURNING id
  `, [ctx.tenant_id, ctx.merchant_id, ctx.outlet_id, tx])).rows[0].id;

  const stockAfterQueue = (await client.query("SELECT current_stock FROM pos.inventory_balances WHERE inventory_item_id = $1 AND outlet_id = $2", [detItem, ctx.outlet_id])).rows[0].current_stock;
  console.log('2. Saldo Deterjen Setelah Drop-Off (Status: QUEUED):', stockAfterQueue, 'ml (HARUS TETAP 10000)');

  // 3. Operator starts the washing machine (Status: IN_PROGRESS)
  console.log('--- Operator Memulai Mesin Cuci (Status: IN_PROGRESS) ---');
  await client.query(`
    UPDATE pos.operational_jobs
       SET status = 'IN_PROGRESS'
     WHERE id = $1
  `, [jobId]);

  const stockAfterStart = (await client.query("SELECT current_stock FROM pos.inventory_balances WHERE inventory_item_id = $1 AND outlet_id = $2", [detItem, ctx.outlet_id])).rows[0].current_stock;
  console.log('3. Saldo Deterjen Setelah Mesin Berputar (Status: IN_PROGRESS):', stockAfterStart, 'ml (TERPOTONG 75ml: 5kg x 15ml)');

  // 4. Check Board
  console.log('--- Querying contract.workshop_jobs_board ---');
  const board = await client.query("SELECT job_number, job_status, is_bom_consumed, consumed_at, resource_name FROM contract.workshop_jobs_board WHERE job_id = $1", [jobId]);
  console.table(board.rows);

} finally {
  await client.end();
}
