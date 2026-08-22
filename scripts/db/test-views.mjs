import 'dotenv/config';
import pg from 'pg';

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('--- Testing queries on all schemas & views ---');

  const schemas = ['pos', 'billing', 'ai', 'internal', 'contract'];
  for (const s of schemas) {
    const tables = await client.query(`
      SELECT table_name, table_type 
      FROM information_schema.tables 
      WHERE table_schema = $1
    `, [s]);

    console.log(`\nSchema [${s}] (${tables.rows.length} items):`);
    for (const t of tables.rows) {
      try {
        const res = await client.query(`SELECT * FROM "${s}"."${t.table_name}" LIMIT 1`);
        console.log(`  ✓ ${t.table_name} (${t.table_type}) - ${res.rowCount} row`);
      } catch (err) {
        console.error(`  ✗ ${t.table_name} (${t.table_type}) - ERROR:`, err.message);
      }
    }
  }

  await client.end();
}

main().catch(console.error);
