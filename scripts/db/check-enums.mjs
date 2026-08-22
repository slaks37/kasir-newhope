import 'dotenv/config';
import pg from 'pg';

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();

  const enums = await client.query(`
    SELECT t.typname, e.enumlabel
    FROM pg_type t 
    JOIN pg_enum e ON t.oid = e.enumtypid  
    JOIN pg_namespace n ON n.oid = t.typnamespace
    ORDER BY t.typname, e.enumsortorder
  `);
  console.log('Enums in DB:', enums.rows);

  await client.end();
}

main().catch(console.error);
