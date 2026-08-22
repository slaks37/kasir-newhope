import pg from 'pg';
import 'dotenv/config';
const client = new pg.Client(process.env.DATABASE_URL);
await client.connect();
try {
  console.log('--- 1. Querying contract.merchant_staff ---');
  const staff = await client.query('SELECT scope_type, staff_name, role, merchant_name, outlet_name FROM contract.merchant_staff LIMIT 6');
  console.table(staff.rows);

  console.log('--- 2. Testing Illegal Scope Combination (Should Fail) ---');
  // Attempt to insert TENANT scope with a merchant_id (Violates check constraint)
  try {
    await client.query(`
      INSERT INTO internal.memberships (user_id, scope_type, tenant_id, merchant_id, role)
      VALUES (
        (SELECT id FROM internal.users LIMIT 1),
        'TENANT',
        (SELECT id FROM internal.tenants LIMIT 1),
        (SELECT id FROM internal.merchants LIMIT 1),
        'TENANT_OWNER'
      )
    `);
    console.error('TEST FAILED: Illegal insert was allowed!');
  } catch (err) {
    console.log('SUCCESS: Database successfully rejected illegal scope constraint:', err.message);
  }

} finally {
  await client.end();
}
