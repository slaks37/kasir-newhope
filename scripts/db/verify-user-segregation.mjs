import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  console.log('=== VERIFIKASI PEMISAHAN USER ADMIN DAN USER CLIENT ===\n');

  console.log('1. DATA USER ADMIN (internal.internal_users - Platform Back-Office):');
  const adminUsers = await client.query(`
    SELECT id, email, full_name, role, is_active, created_at 
    FROM internal.internal_users 
    ORDER BY role, email;
  `);
  console.table(adminUsers.rows);

  console.log('\n2. DATA USER CLIENT (pos.users - Merchant Store Staff & Cashiers):');
  const clientUsers = await client.query(`
    SELECT u.id, u.tenant_id, t.name as store_name, t.business_sector, u.name, u.username, u.role, u.pin
    FROM pos.users u
    LEFT JOIN pos.tenants t ON t.id = u.tenant_id
    ORDER BY t.business_sector, u.role;
  `);
  console.table(clientUsers.rows);

  console.log('\n3. DATA AUTH SUPABASE (auth.users):');
  const authUsers = await client.query(`
    SELECT id, email, role, raw_user_meta_data->>'role' as custom_role, created_at 
    FROM auth.users;
  `);
  console.table(authUsers.rows);

  await client.end();
}

main().catch(console.error);
