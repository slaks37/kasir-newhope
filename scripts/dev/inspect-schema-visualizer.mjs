import 'dotenv/config';
import pg from 'pg';

async function check() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const fk = await client.query(`
    SELECT
      tc.table_schema || '.' || tc.table_name as source_table, 
      kcu.column_name, 
      ccu.table_schema || '.' || ccu.table_name as target_table,
      ccu.column_name as target_column 
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
    ORDER BY tc.table_schema, tc.table_name;
  `);

  console.log('--- FOREIGN KEYS / ERD RELATIONS (' + fk.rows.length + ') ---');
  console.table(fk.rows);
  await client.end();
}

check().catch(console.error);
