import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  console.log('--- Testing Unified Modifier -> Recipe Engine ---');

  const mRes = await client.query("SELECT id, tenant_id FROM internal.merchants WHERE business_sector = 'FNB' LIMIT 1");
  const merchantId = mRes.rows[0].id;
  const tenantId = mRes.rows[0].tenant_id;

  // Get recipe of Batch Espresso Base (Level 2 recipe)
  const espRecipe = (await client.query("SELECT id FROM pos.recipes WHERE recipe_name = 'Formula Batch Espresso Base' LIMIT 1")).rows[0]?.id;

  // Insert or update Modifier: 'Extra Double Shot Espresso'
  const modId = (await client.query(`
    INSERT INTO pos.modifiers (tenant_id, merchant_id, name, price, cost_price, recipe_id)
    VALUES ($1, $2, 'Extra Double Shot Espresso', 10000, 2500, $3)
    ON CONFLICT (merchant_id, name) DO UPDATE SET recipe_id = EXCLUDED.recipe_id
    RETURNING id
  `, [tenantId, merchantId, espRecipe])).rows[0].id;

  console.log('--- Querying contract.modifier_directory ---');
  const modDir = await client.query(`
    SELECT modifier_name, price, cost_price, recipe_name
      FROM contract.modifier_directory
     WHERE modifier_id = $1
  `, [modId]);
  console.table(modDir.rows);

  console.log('--- Direct Component Breakdown for Modifier via Central Recipe Engine ---');
  const components = await client.query(`
    SELECT r.recipe_name, i.item_name, i.item_type, ri.quantity, ri.unit
      FROM pos.modifiers m
      JOIN pos.recipes r ON r.id = m.recipe_id
      JOIN pos.recipe_items ri ON ri.recipe_id = r.id
      JOIN pos.inventory_items i ON i.id = ri.inventory_item_id
     WHERE m.id = $1
  `, [modId]);
  console.table(components.rows);

} finally {
  await client.end();
}
