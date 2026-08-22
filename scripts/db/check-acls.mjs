import 'dotenv/config';
import pg from 'pg';

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('--- Checking schema permissions in Supabase ---');

  const perms = await client.query(`
    SELECT nspname, nspacl 
    FROM pg_namespace 
    WHERE nspname IN ('pos', 'ai', 'billing', 'internal', 'contract', 'public')
  `);
  console.log('Schema ACLs:', perms.rows);

  await client.end();
}

main().catch(console.error);
