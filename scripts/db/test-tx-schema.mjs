import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  const tCols = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'transactions'");
  console.log('pos.transactions columns:', tCols.rows);
} finally {
  await client.end();
}
