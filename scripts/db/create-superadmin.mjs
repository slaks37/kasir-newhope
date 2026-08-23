import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  // TIDAK ADA KREDENSIAL DI BERKAS INI.
  //
  // Sebelumnya email dan password superadmin tertulis apa adanya di sini, dan
  // sudah terlanjur masuk riwayat repositori. Siapa pun yang pernah membuka
  // repo memegang akun dengan wewenang tertinggi di platform.
  //
  // Skrip ini sekarang MENOLAK BERJALAN tanpa variabel lingkungan. Memberi
  // nilai bawaan akan mengembalikan masalah yang sama dalam bentuk lain.
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  const fullName = process.env.SUPERADMIN_NAME || 'Superadmin';

  if (!email || !password) {
    console.error(
      'Dihentikan. Isi SUPERADMIN_EMAIL dan SUPERADMIN_PASSWORD lebih dulu:\n\n' +
      '  SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... node scripts/db/create-superadmin.mjs\n'
    );
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('Dihentikan. SUPERADMIN_PASSWORD minimal 12 karakter.');
    process.exit(1);
  }

  await client.connect();

  console.log(`[1] Ensuring pgcrypto extension is active...`);
  await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  console.log(`[2] Inserting superadmin into internal.internal_users...`);
  const internalUser = await client.query(`
    INSERT INTO internal.internal_users (email, full_name, role, is_active)
    VALUES ($1, $2, 'ROLE_SUPERADMIN', true)
    ON CONFLICT (email) DO UPDATE SET 
      full_name = EXCLUDED.full_name,
      role = 'ROLE_SUPERADMIN',
      is_active = true,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *;
  `, [email, fullName]);
  console.log('internal.internal_users created:', internalUser.rows[0]);

  console.log(`[3] Creating / Updating user in auth.users...`);
  const authUserCheck = await client.query(`SELECT id FROM auth.users WHERE email = $1;`, [email]);
  
  if (authUserCheck.rows.length === 0) {
    const newAuthUser = await client.query(`
      INSERT INTO auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        $1::text,
        crypt($2::text, gen_salt('bf')),
        CURRENT_TIMESTAMP,
        '{"provider": "email", "providers": ["email"], "role": "ROLE_SUPERADMIN"}'::jsonb,
        jsonb_build_object('full_name', $3::text, 'role', 'ROLE_SUPERADMIN'),
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      RETURNING id, email, created_at;
    `, [email, password, fullName]);
    console.log('auth.users created:', newAuthUser.rows[0]);
  } else {
    const updatedAuthUser = await client.query(`
      UPDATE auth.users 
      SET 
        encrypted_password = crypt($2::text, gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, CURRENT_TIMESTAMP),
        raw_app_meta_data = '{"provider": "email", "providers": ["email"], "role": "ROLE_SUPERADMIN"}'::jsonb,
        raw_user_meta_data = jsonb_build_object('full_name', $3::text, 'role', 'ROLE_SUPERADMIN'),
        updated_at = CURRENT_TIMESTAMP
      WHERE email = $1::text
      RETURNING id, email, updated_at;
    `, [email, password, fullName]);
    console.log('auth.users password updated:', updatedAuthUser.rows[0]);
  }

  // Sejak 0033 kredensial dan kepegawaian terpisah, jadi ini tiga sisipan.
  console.log(`[4] Inserting into pos.auth_users / pos.staff_users...`);
  const tenantRes = await client.query(`SELECT id, merchant_id FROM pos.businesses LIMIT 1;`);
  const tenantId = tenantRes.rows[0]?.id;
  if (tenantId) {
    const cred = await client.query(`
      INSERT INTO pos.auth_users (business_id, login, pin)
      VALUES ($1, $2, '2012')
      ON CONFLICT (business_id, login) DO UPDATE SET pin = EXCLUDED.pin
      RETURNING id;
    `, [tenantId, email]);
    const staf = await client.query(`
      INSERT INTO pos.staff_users
        (business_id, merchant_id, auth_user_id, name, employee_code, status, joined_at)
      VALUES ($1, $2, $3, $4, $5, 'AKTIF', CURRENT_TIMESTAMP)
      ON CONFLICT (business_id, employee_code) WHERE employee_code IS NOT NULL
      DO UPDATE SET name = EXCLUDED.name, auth_user_id = EXCLUDED.auth_user_id
      RETURNING id;
    `, [tenantId, tenantRes.rows[0]?.merchant_id ?? null, cred.rows[0].id, fullName, email]);
    await client.query(`
      INSERT INTO pos.user_roles (staff_user_id, role_code) VALUES ($1, 'ADMIN')
      ON CONFLICT DO NOTHING;
    `, [staf.rows[0].id]);
  }

  console.log(`✅ Superadmin ${email} has been successfully configured in Supabase!`);
  await client.end();
}

main().catch((err) => {
  console.error('Error creating superadmin:', err);
  process.exit(1);
});
