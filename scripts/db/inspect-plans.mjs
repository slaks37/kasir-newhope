import 'dotenv/config';
import pg from 'pg';

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();

  const plans = await client.query(`SELECT * FROM billing.plans`);
  console.log('Plans in billing.plans:', plans.rows);

  await client.end();
}

main().catch(console.error);
