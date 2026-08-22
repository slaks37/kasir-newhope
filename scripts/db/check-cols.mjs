import pg from 'pg';
import { config } from 'dotenv';
config();
config({ path: '.env.local' });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const res = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns 
    WHERE table_schema = 'pos' AND table_name = 'inventory_logs';
  `);
  console.log(res.rows.map(r => `${r.column_name}: ${r.data_type}`).join('\n'));
} finally {
  await client.end();
}
