// Isolated permission regression. No cloud credentials, requests or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const targets = {
  ai: ['ai_query_logs', 'daily_merchant_insights', 'merchant_ai_credits'],
  billing: ['invoices', 'plans', 'subscriptions'],
  pos: ['merchant_activity_log', 'products', 'tenants', 'transaction_items', 'transactions', 'users'],
};
const pg = new PGlite();
try {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE server_reader;');
  for (const [schema, tables] of Object.entries(targets)) {
    await pg.exec(`CREATE SCHEMA ${schema}; GRANT USAGE ON SCHEMA ${schema} TO anon, authenticated, service_role, server_reader;`);
    for (const table of tables) {
      await pg.exec(`CREATE TABLE ${schema}.${table}(id int PRIMARY KEY, owner_id text);
        INSERT INTO ${schema}.${table} VALUES (1,'owner-a'),(2,'owner-b');
        ALTER TABLE ${schema}.${table} ENABLE ROW LEVEL SECURITY;
        GRANT ALL ON ${schema}.${table} TO anon, authenticated, service_role;
        GRANT SELECT ON ${schema}.${table} TO server_reader;
        CREATE POLICY p_${table}_all ON ${schema}.${table} TO anon,authenticated,service_role USING(true) WITH CHECK(true);`);
    }
  }
  const sql = fs.readFileSync('docs/security/restrict-browser-rls-policies.sql', 'utf8');
  await pg.exec(sql);
  await pg.exec(sql); // Safe to reapply.
  for (const [schema, tables] of Object.entries(targets)) for (const table of tables) {
    const relation = `${schema}.${table}`;
    const policy = await pg.query<{roles:string[]}>(`SELECT roles FROM pg_policies WHERE schemaname=$1 AND tablename=$2`, [schema,table]);
    assert.deepEqual(policy.rows[0].roles,['service_role']);
    for (const role of ['anon','authenticated']) {
      const access = await pg.query<{allowed:boolean}>('SELECT has_table_privilege($1,$2,$3) AS allowed',[role,relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER']);
      assert.equal(access.rows[0].allowed,false,`${role} ${relation}`);
      for (const statement of [`SELECT * FROM ${relation}`,`INSERT INTO ${relation} VALUES (3,'attacker')`, `UPDATE ${relation} SET owner_id='attacker'`, `DELETE FROM ${relation}`]) {
        await assert.rejects(()=>pg.transaction(async tx=>{
          await tx.exec(`SET LOCAL ROLE ${role}`);
          await tx.exec(statement);
        }),/permission denied/);
      }
    }
    await pg.transaction(async tx=>{
      await tx.exec('SET LOCAL ROLE service_role');
      assert.equal((await tx.query(`SELECT * FROM ${relation}`)).rows.length,2);
    });
    assert.equal((await pg.query<{allowed:boolean}>('SELECT has_table_privilege($1,$2,$3) AS allowed',['server_reader',relation,'SELECT'])).rows[0].allowed,true);
    assert.equal((await pg.query<{enabled:boolean}>('SELECT relrowsecurity AS enabled FROM pg_class WHERE oid=$1::regclass',[relation])).rows[0].enabled,true);
  }
  console.log('PASS: 12 policies restricted; 96 browser read/write denials; server access, RLS and all fixture rows preserved; idempotent');
} finally { await pg.close(); }
