import 'dotenv/config';
import pg from 'pg';

async function main() {
  const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  const admins = [
    { email: 'stefenlaksana.sl@gmail.com', name: 'Stefen Laksana (Superadmin)', uid: 'afb01c34-4711-49ed-a6a8-8658dc98adc8' },
    { email: 'johan.maxy.academy@gmail.com', name: 'Johan (Superadmin)', uid: 'e23a9607-91f5-4879-ad91-5b7cf83f2c9b' },
    { email: 'johankevin22@gmail.com', name: 'Johan Kevin (Superadmin)', uid: '1ca0a3d1-b262-44f7-8cef-5b1f7ce60a58' },
    { email: 'stefen.laksana@gmail.com', name: 'Stefen Laksana (Superadmin)', uid: '7ae01c40-4748-48eb-ba49-b2270e363ad9' },
  ];

  for (const a of admins) {
    await c.query(`
      INSERT INTO internal.internal_users (id, email, full_name, role, sso_subject, is_active)
      VALUES (gen_random_uuid(), $1, $2, 'ROLE_SUPERADMIN', $3, true)
      ON CONFLICT (email) DO UPDATE SET
        sso_subject = EXCLUDED.sso_subject,
        role = 'ROLE_SUPERADMIN',
        is_active = true,
        updated_at = NOW()
    `, [a.email, a.name, a.uid]);
    console.log('✓ Granted ROLE_SUPERADMIN in internal.internal_users:', a.email);

    await c.query(`
      INSERT INTO public.admin_users (id, email, full_name, role, is_active)
      VALUES (gen_random_uuid(), $1, $2, 'ROLE_SUPERADMIN', true)
      ON CONFLICT (email) DO UPDATE SET
        role = 'ROLE_SUPERADMIN',
        is_active = true,
        updated_at = NOW()
    `, [a.email, a.name]);
    console.log('✓ Synced in public.admin_users:', a.email);
  }

  await c.end();
}

main().catch(console.error);
