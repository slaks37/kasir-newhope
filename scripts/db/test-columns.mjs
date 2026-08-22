import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'inventory_logs'");
  console.log(res.rows);
} finally {
  await client.end();
}
