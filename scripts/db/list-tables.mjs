import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local' });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const res = await client.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables 
    WHERE table_schema IN ('pos', 'internal', 'contract', 'public')
    ORDER BY table_schema, table_name;
  `);
  console.log(res.rows.map(r => `${r.table_schema}.${r.table_name}`).join('\n'));
} finally {
  await client.end();
}
