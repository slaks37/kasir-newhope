import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  const cols = await client.query(`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns 
    WHERE table_schema = 'internal' AND table_name = 'internal_users';
  `);
  console.log('internal_users columns:', cols.rows);

  const users = await client.query(`SELECT * FROM internal.internal_users;`);
  console.log('internal_users rows:', users.rows);

  await client.end();
}
main().catch(console.error);
