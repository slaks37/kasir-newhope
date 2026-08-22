import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
config();
config({ path: '.env.local' });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const migrationsDir = join(process.cwd(), 'migrations');
  const files = readdirSync(migrationsDir).sort();
  
  for (const file of files) {
    if (file.match(/^00(33|34)/)) {
      console.log(`Applying ${file}...`);
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      await client.query(sql);
      console.log(`✓ ${file} applied.`);
    }
  }
} catch (err) {
  console.error(err);
} finally {
  await client.end();
}
