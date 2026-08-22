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

  // PIN sengaja TIDAK dibaca: skrip pemeriksa yang mencetak kredensial ke
  // terminal adalah kebocoran yang dibuat sendiri. staff_directory memang tidak
  // memuatnya, jadi ini tidak bisa lupa.
  console.log('\n2. DATA USER CLIENT (contract.staff_directory - Merchant Store Staff & Cashiers):');
  const clientUsers = await client.query(`
    SELECT d.staff_user_id AS id, d.business_id, t.name as store_name, t.business_sector,
           d.name, d.login, d.status, d.roles
    FROM contract.staff_directory d
    LEFT JOIN pos.businesses t ON t.id = d.business_id
    ORDER BY t.business_sector, d.name;
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
