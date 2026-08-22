import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  const invRows = await client.query("SELECT id, item_name, sku, product_id, ingredient_id FROM pos.inventory_items LIMIT 10");
  console.log('pos.inventory_items sample:', invRows.rows);
} finally {
  await client.end();
}
