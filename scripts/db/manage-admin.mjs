#!/usr/bin/env node
/**
 * CLI Tool untuk Mengelola Akun Admin & Superadmin New Hope POS
 *
 * Penggunaan:
 *   node scripts/db/manage-admin.mjs list
 *   node scripts/db/manage-admin.mjs link <email>
 *   node scripts/db/manage-admin.mjs add <email> <nama> [role]
 *   node scripts/db/manage-admin.mjs sync-all
 */

import 'dotenv/config';
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('ERROR: DATABASE_URL belum diatur di file .env');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function listAdmins() {
  console.log('\n=== DAFTAR PENGGUNA INTERNAL BACK-OFFICE (internal.internal_users) ===');
  const internalRes = await client.query(`
    SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.sso_subject,
           a.id AS auth_user_id, a.email_confirmed_at
    FROM internal.internal_users u
    LEFT JOIN auth.users a ON LOWER(a.email) = LOWER(u.email)
    ORDER BY u.created_at ASC
  `);

  if (internalRes.rows.length === 0) {
    console.log('Tidak ada pengguna di internal.internal_users.');
  } else {
    for (const r of internalRes.rows) {
      const isLinked = r.sso_subject && r.sso_subject === r.auth_user_id;
      const status = isLinked
        ? '✓ TERHUBUNG (Siap Login)'
        : r.auth_user_id
        ? '⚠️ PERLU LINK (Ada di Supabase Auth tapi sso_subject belum terikat)'
        : '❌ BELUM TERDAFTAR DI SUPABASE AUTH';

      console.log(`- Email       : ${r.email}`);
      console.log(`  Nama        : ${r.full_name}`);
      console.log(`  Role        : ${r.role}`);
      console.log(`  Aktif       : ${r.is_active}`);
      console.log(`  Auth UID    : ${r.auth_user_id || '(belum ada di auth.users)'}`);
      console.log(`  sso_subject : ${r.sso_subject || '(NULL)'}`);
      console.log(`  Status      : ${status}\n`);
    }
  }

  try {
    const publicAdminRes = await client.query('SELECT * FROM public.admin_users ORDER BY created_at ASC');
    if (publicAdminRes.rows.length > 0) {
      console.log('=== DATA LEGACY (public.admin_users) ===');
      for (const r of publicAdminRes.rows) {
        console.log(`- ${r.email} | ${r.full_name} | ${r.role} | Aktif: ${r.is_active}`);
      }
      console.log('');
    }
  } catch {
    // Abaikan jika public.admin_users tidak ada
  }
}

async function linkAdmin(email) {
  if (!email) {
    console.error('Mohon masukkan email: node scripts/db/manage-admin.mjs link <email>');
    return;
  }

  const authUser = await client.query('SELECT id, email FROM auth.users WHERE LOWER(email) = LOWER($1)', [email]);
  if (!authUser.rows[0]) {
    console.error(`Akun ${email} tidak ditemukan di auth.users Supabase.`);
    console.error('Silakan pastikan akun telah didaftarkan melalui Supabase Auth terlebih dahulu.');
    return;
  }

  const authUid = authUser.rows[0].id;
  const updateRes = await client.query(
    `UPDATE internal.internal_users
     SET sso_subject = $1, updated_at = NOW()
     WHERE LOWER(email) = LOWER($2)
     RETURNING *`,
    [authUid, email]
  );

  if (updateRes.rows[0]) {
    console.log(`✓ Berhasil menautkan ${email} dengan Supabase Auth UID: ${authUid}`);
  } else {
    console.log(`Akun ${email} belum ada di internal.internal_users.`);
    console.log(`Menambahkan akun baru ke internal.internal_users...`);
    const insertRes = await client.query(
      `INSERT INTO internal.internal_users (id, email, full_name, role, sso_subject, is_active)
       VALUES (gen_random_uuid(), $1, $2, 'ROLE_SUPERADMIN', $3, true)
       RETURNING *`,
      [email, 'Superadmin', authUid]
    );
    console.log(`✓ Berhasil membuat dan menautkan superadmin baru:`, insertRes.rows[0]);
  }
}

async function addAdmin(email, fullName, role = 'ROLE_SUPERADMIN') {
  if (!email || !fullName) {
    console.error('Penggunaan: node scripts/db/manage-admin.mjs add <email> <nama> [role]');
    return;
  }

  const authUser = await client.query('SELECT id FROM auth.users WHERE LOWER(email) = LOWER($1)', [email]);
  const authUid = authUser.rows[0]?.id || null;

  const res = await client.query(
    `INSERT INTO internal.internal_users (id, email, full_name, role, sso_subject, is_active)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, true)
     ON CONFLICT (email) DO UPDATE
     SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, sso_subject = COALESCE(EXCLUDED.sso_subject, internal.internal_users.sso_subject), is_active = true, updated_at = NOW()
     RETURNING *`,
    [email, fullName, role, authUid]
  );

  console.log(`✓ Berhasil menyimpan data internal user:`);
  console.log(res.rows[0]);
  if (!authUid) {
    console.log(`\n⚠️ Catatan: Email ${email} belum terdaftar di auth.users Supabase.`);
    console.log(`Setelah mendaftar/login di Supabase, jalankan:`);
    console.log(`  node scripts/db/manage-admin.mjs link ${email}`);
  }
}

async function syncAll() {
  console.log('Menyelaraskan semua akun internal.internal_users dengan auth.users...');
  const res = await client.query(`
    UPDATE internal.internal_users u
    SET sso_subject = a.id, updated_at = NOW()
    FROM auth.users a
    WHERE LOWER(u.email) = LOWER(a.email)
      AND (u.sso_subject IS NULL OR u.sso_subject <> a.id::varchar)
    RETURNING u.email, a.id AS auth_id
  `);

  if (res.rows.length === 0) {
    console.log('Semua akun yang cocok sudah tersinkronisasi.');
  } else {
    console.log(`✓ Berhasil menyinkronkan ${res.rows.length} akun:`);
    for (const r of res.rows) {
      console.log(`  - ${r.email} -> UID ${r.auth_id}`);
    }
  }

  // Sync from public.admin_users if present
  try {
    const publicSync = await client.query(`
      INSERT INTO internal.internal_users (id, email, full_name, role, sso_subject, is_active)
      SELECT gen_random_uuid(), p.email, p.full_name, p.role, a.id, true
      FROM public.admin_users p
      LEFT JOIN auth.users a ON LOWER(a.email) = LOWER(p.email)
      ON CONFLICT (email) DO UPDATE
      SET sso_subject = COALESCE(EXCLUDED.sso_subject, internal.internal_users.sso_subject),
          role = EXCLUDED.role,
          is_active = true
      RETURNING email
    `);
    if (publicSync.rows.length > 0) {
      console.log(`✓ Sinkronisasi dari public.admin_users selesai (${publicSync.rows.length} akun).`);
    }
  } catch {
    // Abaikan jika public.admin_users tidak ada
  }
}

async function main() {
  await client.connect();
  const cmd = process.argv[2] || 'list';

  try {
    switch (cmd) {
      case 'list':
        await listAdmins();
        break;
      case 'link':
        await linkAdmin(process.argv[3]);
        break;
      case 'add':
        await addAdmin(process.argv[3], process.argv[4], process.argv[5]);
        break;
      case 'sync-all':
        await syncAll();
        break;
      default:
        console.log(`Perintah tidak dikenal: ${cmd}`);
        console.log('Pilihan: list, link <email>, add <email> <nama> [role], sync-all');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
