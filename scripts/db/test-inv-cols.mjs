import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'inventory_transactions'");
  console.log('pos.inventory_transactions columns:', cols.rows.map(r => r.column_name));
} finally {
  await client.end();
}
