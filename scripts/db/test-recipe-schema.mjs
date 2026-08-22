import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  const res = await client.query("SELECT conname FROM pg_constraint WHERE conrelid = 'pos.inventory_items'::regclass");
  console.log('Constraints on pos.inventory_items:', res.rows);
} finally {
  await client.end();
}
