import 'dotenv/config';
import pg from 'pg';

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();

  const users = await client.query(`SELECT * FROM internal.internal_users`);
  console.log('Internal Admin Users in DB:', users.rows);

  await client.end();
}

main().catch(console.error);
