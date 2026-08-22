import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  console.log('--- 1. contract.catalog (Commercial Offerings) ---');
  const catalog = await client.query('SELECT product_name, offering_type, price, cost_price, margin_pct, stock FROM contract.catalog LIMIT 5');
  console.table(catalog.rows);

  console.log('--- 2. contract.stock_status (Physical Stock Items) ---');
  const stock = await client.query('SELECT item_name, sku, unit, item_type, cost_per_unit, is_stockable, current_stock FROM contract.stock_status LIMIT 6');
  console.table(stock.rows);
} finally {
  await client.end();
}
