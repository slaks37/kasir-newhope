import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  console.log('\n2. PERAN & PENGGUNA BACKOFFICE (internal.users, roles, dll)');
  const internalQuery = `
      SELECT table_name, 
             (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name) as cols
      FROM information_schema.tables t
      WHERE table_schema = 'internal' 
        AND table_name IN ('users', 'roles', 'permissions', 'role_permissions', 'user_roles')
      ORDER BY table_name;
  `;
  const cols = await client.query(internalQuery);
  console.log('internal tables:', cols.rows);

  const users = await client.query(`SELECT * FROM internal.users;`);
  console.log('internal.users rows:', users.rows);

  await client.end();
}
main().catch(console.error);
