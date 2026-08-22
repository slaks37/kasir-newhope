import 'dotenv/config';
import pg from 'pg';

const sql = `
-- Berikan izin USAGE ke semua schema
GRANT USAGE ON SCHEMA public, pos, billing, ai, internal, contract TO postgres, anon, authenticated, service_role;

-- Berikan izin akses penuh ke semua tabel dan view
GRANT ALL ON ALL TABLES IN SCHEMA public, pos, billing, ai, internal, contract TO postgres, anon, authenticated, service_role;

-- Berikan izin ke semua sequence (penomoran otomatis)
GRANT ALL ON ALL SEQUENCES IN SCHEMA public, pos, billing, ai, internal, contract TO postgres, anon, authenticated, service_role;

-- Berikan izin ke semua function / routines
GRANT ALL ON ALL ROUTINES IN SCHEMA public, pos, billing, ai, internal, contract TO postgres, anon, authenticated, service_role;

-- Setel Default Privileges untuk objek yang dibuat di masa mendatang
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pos GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA billing GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA internal GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA contract GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;

-- Reload Supabase PostgREST schema cache
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
`;

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Fixing Supabase Table Editor permissions and reloading PostgREST schema cache...');
  await client.query(sql);
  console.log('Permissions granted and schema cache reloaded successfully!');

  await client.end();
}

main().catch(console.error);
