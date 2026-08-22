import 'dotenv/config';
import pg from 'pg';

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('--- Connected to Remote Supabase ---');

  const schemas = await client.query(`
    SELECT schema_name FROM information_schema.schemata 
    WHERE schema_name IN ('pos', 'ai', 'billing', 'internal', 'contract')
  `);
  console.log('Schemas:', schemas.rows.map(r => r.schema_name));

  const tables = await client.query(`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema IN ('pos', 'ai', 'billing', 'internal', 'contract')
    ORDER BY table_schema, table_name
  `);
  console.log(`Tables count: ${tables.rows.length}`);
  console.log('Tables:', tables.rows);

  const funcs = await client.query(`
    SELECT routine_name, routine_schema 
    FROM information_schema.routines 
    WHERE routine_name = 'custom_signup'
  `);
  console.log('custom_signup routine:', funcs.rows);

  await client.end();
}

main().catch(console.error);
