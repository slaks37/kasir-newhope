import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();

  /*
   * Kredensial datang dari environment, tidak pernah dari berkas ini.
   *
   * Sebelumnya email dan kata sandi superadmin tertulis langsung di sini.
   * Berkas ini ada di dalam repositori, jadi kata sandinya ikut tersimpan di
   * riwayat git — terbaca siapa pun yang punya akses ke repo, sekarang maupun
   * nanti, dan tetap ada walau barisnya dihapus hari ini.
   *
   * Kata sandi yang pernah tertulis di sini WAJIB dianggap bocor dan diganti.
   */
  const email = String(process.env.INTERNAL_ROOT_EMAIL || '').trim().toLowerCase();
  const password = process.env.INTERNAL_ROOT_PASSWORD || '';
  const fullName = process.env.INTERNAL_ROOT_NAME || 'Platform Owner';

  if (!email || !password) {
    console.error(
      'INTERNAL_ROOT_EMAIL dan INTERNAL_ROOT_PASSWORD wajib diisi.\n' +
        'Contoh:\n' +
        '  INTERNAL_ROOT_EMAIL="anda@domain.com" INTERNAL_ROOT_PASSWORD="..." npm run db:superadmin'
    );
    process.exitCode = 1;
    await client.end();
    return;
  }
  if (password.length < 12) {
    console.error('INTERNAL_ROOT_PASSWORD terlalu pendek. Gunakan minimal 12 karakter.');
    process.exitCode = 1;
    await client.end();
    return;
  }

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

  console.log(`[4] Inserting into internal.users and internal.memberships...`);
  const globalUser = await client.query(`
    INSERT INTO internal.users (email, full_name, is_platform_user, platform_role, is_active)
    VALUES ($1, $2, TRUE, 'ROLE_SUPERADMIN', TRUE)
    ON CONFLICT (email) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      is_platform_user = TRUE,
      platform_role = 'ROLE_SUPERADMIN',
      is_active = TRUE
    RETURNING id;
  `, [email, fullName]);
  const globalUserId = globalUser.rows[0]?.id;

  const tenantRes = await client.query(`SELECT id FROM internal.tenants LIMIT 1;`);
  const tenantId = tenantRes.rows[0]?.id;
  if (tenantId && globalUserId) {
    await client.query(`
      INSERT INTO internal.memberships (user_id, tenant_id, role, pin, is_active)
      VALUES ($1, $2, 'OWNER', '2012', TRUE)
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET
        role = 'OWNER',
        pin = '2012',
        is_active = TRUE;
    `, [globalUserId, tenantId]);
  }

  console.log(`✅ Superadmin ${email} has been successfully configured in Supabase!`);
  await client.end();
}

main().catch((err) => {
  console.error('Error creating superadmin:', err);
  process.exit(1);
});
