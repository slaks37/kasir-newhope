import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  console.log('--- Setting up 3-Level Recursive BOM Simulation ---');

  // Get tenant & merchant
  const mRes = await client.query("SELECT id, tenant_id FROM internal.merchants WHERE business_sector = 'FNB' LIMIT 1");
  const merchantId = mRes.rows[0].id;
  const tenantId = mRes.rows[0].tenant_id;

  // 1. Create Raw Materials & Packaging (Leaves)
  const gArabica = (await client.query(`
    INSERT INTO pos.inventory_items (tenant_id, merchant_id, sku, item_name, base_unit, cost_per_unit, item_type)
    VALUES ($1, $2, 'RM-GB-ARA', 'Green Bean Arabica Gayo', 'gram', 0.12, 'RAW_MATERIAL')
    ON CONFLICT (merchant_id, sku) DO UPDATE SET item_name = EXCLUDED.item_name
    RETURNING id
  `, [tenantId, merchantId])).rows[0].id;

  const gRobusta = (await client.query(`
    INSERT INTO pos.inventory_items (tenant_id, merchant_id, sku, item_name, base_unit, cost_per_unit, item_type)
    VALUES ($1, $2, 'RM-GB-ROB', 'Green Bean Robusta Dampit', 'gram', 0.08, 'RAW_MATERIAL')
    ON CONFLICT (merchant_id, sku) DO UPDATE SET item_name = EXCLUDED.item_name
    RETURNING id
  `, [tenantId, merchantId])).rows[0].id;

  const waterRO = (await client.query(`
    INSERT INTO pos.inventory_items (tenant_id, merchant_id, sku, item_name, base_unit, cost_per_unit, item_type)
    VALUES ($1, $2, 'RM-WATER-RO', 'Air RO Terfiltrasi', 'ml', 0.005, 'RAW_MATERIAL')
    ON CONFLICT (merchant_id, sku) DO UPDATE SET item_name = EXCLUDED.item_name
    RETURNING id
  `, [tenantId, merchantId])).rows[0].id;

  const freshMilk = (await client.query(`
    INSERT INTO pos.inventory_items (tenant_id, merchant_id, sku, item_name, base_unit, cost_per_unit, item_type)
    VALUES ($1, $2, 'RM-MILK-FRESH', 'Susu Segar Pasteurisasi', 'ml', 0.02, 'RAW_MATERIAL')
    ON CONFLICT (merchant_id, sku) DO UPDATE SET item_name = EXCLUDED.item_name
    RETURNING id
  `, [tenantId, merchantId])).rows[0].id;

  const paperCup = (await client.query(`
    INSERT INTO pos.inventory_items (tenant_id, merchant_id, sku, item_name, base_unit, cost_per_unit, item_type)
    VALUES ($1, $2, 'PKG-CUP-12OZ', 'Paper Cup 12oz', 'pcs', 500, 'PACKAGING')
    ON CONFLICT (merchant_id, sku) DO UPDATE SET item_name = EXCLUDED.item_name
    RETURNING id
  `, [tenantId, merchantId])).rows[0].id;

  // 2. Create Semi-Finished Items
  const roastedBeans = (await client.query(`
    INSERT INTO pos.inventory_items (tenant_id, merchant_id, sku, item_name, base_unit, cost_per_unit, item_type)
    VALUES ($1, $2, 'SF-ROAST-HOUSE', 'House Blend Roasted Beans', 'gram', 0.15, 'SEMI_FINISHED')
    ON CONFLICT (merchant_id, sku) DO UPDATE SET item_name = EXCLUDED.item_name
    RETURNING id
  `, [tenantId, merchantId])).rows[0].id;

  const espressoBase = (await client.query(`
    INSERT INTO pos.inventory_items (tenant_id, merchant_id, sku, item_name, base_unit, cost_per_unit, item_type)
    VALUES ($1, $2, 'SF-ESP-BASE', 'Batch Espresso Shot Base', 'ml', 0.06, 'SEMI_FINISHED')
    ON CONFLICT (merchant_id, sku) DO UPDATE SET item_name = EXCLUDED.item_name
    RETURNING id
  `, [tenantId, merchantId])).rows[0].id;

  // 3. Create Commercial Sellable Product (Latte)
  const latteProduct = (await client.query(`
    INSERT INTO pos.products (tenant_id, merchant_id, name, sku, category_name, price, cost_price, offering_type)
    VALUES ($1, $2, 'Es Kopi Latte Spesial', 'FNB-LATTE-SPEC', 'Minuman Kopi', 28000, 7500, 'MANUFACTURED')
    ON CONFLICT DO NOTHING
    RETURNING id
  `, [tenantId, merchantId])).rows[0]?.id || (await client.query("SELECT id FROM pos.products WHERE sku = 'FNB-LATTE-SPEC'")).rows[0].id;

  // 4. Create Level 3 Recipe: Roasted Beans (Yield 1000g from 600g Arabica + 400g Robusta)
  const r3 = (await client.query(`
    INSERT INTO pos.recipes (tenant_id, merchant_id, recipe_name, output_inventory_item_id, yield_quantity, yield_unit)
    VALUES ($1, $2, 'Formula Roasting House Blend', $3, 1000, 'gram')
    ON CONFLICT (merchant_id, output_inventory_item_id) DO UPDATE SET recipe_name = EXCLUDED.recipe_name
    RETURNING id
  `, [tenantId, merchantId, roastedBeans])).rows[0].id;

  await client.query(`DELETE FROM pos.recipe_items WHERE recipe_id = $1`, [r3]);
  await client.query(`INSERT INTO pos.recipe_items (recipe_id, inventory_item_id, quantity, unit) VALUES ($1, $2, 600, 'gram'), ($1, $3, 400, 'gram')`, [r3, gArabica, gRobusta]);

  // 5. Create Level 2 Recipe: Espresso Base (Yield 1000ml from 250g Roasted Beans + 1200ml Water)
  const r2 = (await client.query(`
    INSERT INTO pos.recipes (tenant_id, merchant_id, recipe_name, output_inventory_item_id, yield_quantity, yield_unit)
    VALUES ($1, $2, 'Formula Batch Espresso Base', $3, 1000, 'ml')
    ON CONFLICT (merchant_id, output_inventory_item_id) DO UPDATE SET recipe_name = EXCLUDED.recipe_name
    RETURNING id
  `, [tenantId, merchantId, espressoBase])).rows[0].id;

  await client.query(`DELETE FROM pos.recipe_items WHERE recipe_id = $1`, [r2]);
  await client.query(`INSERT INTO pos.recipe_items (recipe_id, inventory_item_id, quantity, unit) VALUES ($1, $2, 250, 'gram'), ($1, $3, 1200, 'ml')`, [r2, roastedBeans, waterRO]);

  // 6. Create Level 1 Recipe: Latte Product (Yield 1 cup from 60ml Espresso Base + 150ml Fresh Milk + 1 Cup)
  const r1 = (await client.query(`
    INSERT INTO pos.recipes (tenant_id, merchant_id, recipe_name, output_product_id, yield_quantity, yield_unit)
    VALUES ($1, $2, 'Resep Es Kopi Latte Spesial 12oz', $3, 1, 'portion')
    ON CONFLICT (merchant_id, output_product_id) DO UPDATE SET recipe_name = EXCLUDED.recipe_name
    RETURNING id
  `, [tenantId, merchantId, latteProduct])).rows[0].id;

  await client.query(`DELETE FROM pos.recipe_items WHERE recipe_id = $1`, [r1]);
  await client.query(`INSERT INTO pos.recipe_items (recipe_id, inventory_item_id, quantity, unit) VALUES 
    ($1, $2, 60, 'ml'),
    ($1, $3, 150, 'ml'),
    ($1, $4, 1, 'pcs')
  `, [r1, espressoBase, freshMilk, paperCup]);

  console.log('--- 7. Querying contract.bom_explosion (Full Recursive Solver) ---');
  const bomTree = await client.query(`
    SELECT bom_level, root_product_name, component_item_name, component_item_type, step_quantity, total_effective_quantity, unit
      FROM contract.bom_explosion
     WHERE root_product_name = 'Es Kopi Latte Spesial'
     ORDER BY bom_level, component_item_name
  `);
  console.table(bomTree.rows);

} finally {
  await client.end();
}
