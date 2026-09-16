import 'dotenv/config';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const DB_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://fqxrhumsgigcgjtlbfuo.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

async function setupAdmin() {
  const client = new pg.Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const password = 'qwerty123';
  const targetAccounts = [
    { email: 'admin@newhopepos.id', name: 'Super Admin New Hope' },
    { email: 'stefenlaksana.sl@gmail.com', name: 'Stefen Laksana (Superadmin)' },
    { email: 'johan.maxy.academy@gmail.com', name: 'Johan (Superadmin)' },
  ];

  for (const account of targetAccounts) {
    const email = account.email.toLowerCase().trim();
    const name = account.name;

    // 1. Cek apakah ada di auth.users
    const existing = await client.query('SELECT id FROM auth.users WHERE LOWER(email) = $1', [email]);
    let authUid = existing.rows[0]?.id;

    if (authUid) {
      // Update password yang sudah ada
      await client.query(`
        UPDATE auth.users
        SET encrypted_password = crypt($1, gen_salt('bf', 10)),
            email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
            updated_at = NOW(),
            raw_app_meta_data = raw_app_meta_data || '{"provider":"email","providers":["email"],"role":"ROLE_SUPERADMIN"}'::jsonb,
            raw_user_meta_data = raw_user_meta_data || jsonb_build_object('full_name', $2::text, 'role', 'ROLE_SUPERADMIN')
        WHERE id = $3
      `, [password, name, authUid]);
      console.log(`✓ Password diupdate untuk ${email} (UID: ${authUid})`);
    } else {
      // Buat akun baru di auth.users
      authUid = (await client.query('SELECT gen_random_uuid() AS id')).rows[0].id;
      await client.query(`
        INSERT INTO auth.users (
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          confirmation_token, email_change, email_change_token_new, recovery_token,
          is_super_admin
        )
        VALUES (
          '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
          $2, crypt($3, gen_salt('bf', 10)), NOW(),
          '{"provider":"email","providers":["email"],"role":"ROLE_SUPERADMIN"}'::jsonb,
          jsonb_build_object('full_name', $4::text, 'role', 'ROLE_SUPERADMIN'),
          NOW(), NOW(),
          '', '', '', '', false
        )
      `, [authUid, email, password, name]);
      console.log(`✓ Akun auth baru dibuat: ${email} (UID: ${authUid})`);
    }

    // 2. Hubungkan ke internal.internal_users
    await client.query(`
      INSERT INTO internal.internal_users (id, email, full_name, role, sso_subject, is_active)
      VALUES (gen_random_uuid(), $1, $2, 'ROLE_SUPERADMIN', $3, true)
      ON CONFLICT (email) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        role = 'ROLE_SUPERADMIN',
        sso_subject = EXCLUDED.sso_subject,
        is_active = true,
        updated_at = NOW()
    `, [email, name, authUid]);
    console.log(`✓ Terdaftar di internal.internal_users sebagai ROLE_SUPERADMIN: ${email}`);

    // 3. Hubungkan ke public.admin_users (legacy)
    await client.query(`
      INSERT INTO public.admin_users (id, email, full_name, role, is_active)
      VALUES (gen_random_uuid(), $1, $2, 'ROLE_SUPERADMIN', true)
      ON CONFLICT (email) DO UPDATE SET
        role = 'ROLE_SUPERADMIN',
        is_active = true,
        updated_at = NOW()
    `, [email, name]);
    console.log(`✓ Terdaftar di public.admin_users: ${email}\n`);
  }

  await client.end();

  // 4. Verifikasi Login menggunakan Supabase Client
  console.log('--- MENGUJI LOGIN KE SUPABASE AUTH ---');
  if (SUPABASE_ANON_KEY) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    for (const account of targetAccounts) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: account.email,
        password: password,
      });
      if (error) {
        console.error(`❌ Login Gagal untuk ${account.email}:`, error.message);
      } else {
        console.log(`✅ Login Berhasil untuk ${account.email}! User ID: ${data.user?.id}, Token didapat: ${Boolean(data.session?.access_token)}`);
      }
    }
  } else {
    console.log('VITE_SUPABASE_ANON_KEY belum terkonfigurasi untuk pengetesan client.');
  }
}

setupAdmin().catch(console.error);
