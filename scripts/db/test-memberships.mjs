import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  const res = await client.query("SELECT role, count(*), count(outlet_id) as with_outlet, count(merchant_id) as with_merchant, count(tenant_id) as with_tenant FROM internal.memberships GROUP BY role");
  console.log(res.rows);
} finally {
  await client.end();
}
