import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  const res = await client.query("SELECT * FROM contract.catalog LIMIT 1");
  console.log(res.rows);
} finally {
  await client.end();
}
