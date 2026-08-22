import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'pos' AND table_name LIKE '%modifi%'");
  console.log('Modifier tables in pos schema:', tables.rows);
} finally {
  await client.end();
}
