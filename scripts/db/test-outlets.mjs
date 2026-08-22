import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  const res = await client.query("SELECT id, tenant_id, merchant_id, name FROM internal.outlets");
  console.log(res.rows);
} finally {
  await client.end();
}
