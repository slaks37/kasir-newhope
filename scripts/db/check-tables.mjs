import pg from 'pg';
import { config } from 'dotenv';
config();
config({ path: '.env.local' });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const res = await client.query(`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema IN ('pos', 'billing', 'ai', 'internal', 'contract');
  `);
  console.log(res.rows.map(r => `${r.table_schema}.${r.table_name}`).sort().join('\n'));
} finally {
  await client.end();
}
