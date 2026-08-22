import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  const tTrgs = await client.query("SELECT tgname FROM pg_trigger WHERE tgrelid = 'pos.inventory_transactions'::regclass");
  console.log('Triggers on pos.inventory_transactions:', tTrgs.rows);
} finally {
  await client.end();
}
