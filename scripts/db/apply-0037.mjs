import 'dotenv/config';
import fs from 'fs';
import pg from 'pg';

async function main() {
  const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  console.log('Applying 0037_subscription_operations.sql to remote Supabase...');
  const sql = fs.readFileSync('migrations/0037_subscription_operations.sql', 'utf8');
  await c.query(sql);
  console.log('✓ Migration 0037 applied successfully!');

  await c.end();
}

main().catch(console.error);
