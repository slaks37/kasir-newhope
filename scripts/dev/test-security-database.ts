import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const pg=new PGlite();
const migration=fs.readFileSync('supabase/migrations/20261012091847_browser_role_least_privilege.sql','utf8');
try {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE svc_pos; CREATE ROLE svc_ai; CREATE ROLE svc_billing; CREATE ROLE svc_internal;');
  for(const schema of ['public','pos','internal','billing','ai','contract']){
    if(schema!=='public')await pg.exec('CREATE SCHEMA '+schema);
    await pg.exec(`GRANT USAGE ON SCHEMA ${schema} TO anon,authenticated,service_role,svc_pos;
      CREATE TABLE ${schema}.fixture(tenant text,outlet text);
      INSERT INTO ${schema}.fixture VALUES('tenant-A','outlet-A'),('tenant-B','outlet-B');
      GRANT ALL ON ${schema}.fixture TO anon,authenticated,service_role,svc_pos;
      CREATE SEQUENCE ${schema}.fixture_seq; GRANT ALL ON SEQUENCE ${schema}.fixture_seq TO anon,authenticated,service_role;
      CREATE FUNCTION ${schema}.fixture_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';
      ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT ALL ON TABLES TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;`);
  }
  await pg.exec('GRANT SELECT(tenant) ON pos.fixture TO authenticated');
  await pg.exec(migration);
  for(const role of ['anon','authenticated'])for(const schema of ['public','pos','internal','billing','ai','contract']){
    for(const query of [`SELECT * FROM ${schema}.fixture`,`UPDATE ${schema}.fixture SET tenant='attacker'`,`INSERT INTO ${schema}.fixture VALUES('attacker','outlet-B')`,`DELETE FROM ${schema}.fixture`,`SELECT ${schema}.fixture_fn()`,`SELECT nextval('${schema}.fixture_seq')`]){
      await pg.exec('SET ROLE '+role);
      await assert.rejects(()=>pg.query(query),/permission denied/);
      await pg.exec('RESET ROLE');
    }
  }
  await pg.exec('SET ROLE svc_pos');
  assert.equal((await pg.query('SELECT * FROM pos.fixture')).rows.length,2,'Backend dependency preserved');
  assert.equal((await pg.query('SELECT public.fixture_fn() AS n')).rows[0].n,1,'PUBLIC helper preserved explicitly for backend');
  await pg.exec('RESET ROLE');
  await pg.exec('CREATE TABLE pos.future_fixture(id int); CREATE FUNCTION public.future_fn() RETURNS int LANGUAGE sql AS $$SELECT 2$$;');
  for(const role of ['anon','authenticated']){
    assert.equal((await pg.query('SELECT has_table_privilege($1,$2,$3) AS allowed',[role,'pos.future_fixture','SELECT'])).rows[0].allowed,false);
    assert.equal((await pg.query('SELECT has_function_privilege($1,$2,$3) AS allowed',[role,'public.future_fn()','EXECUTE'])).rows[0].allowed,false);
  }
  await pg.exec(fs.readFileSync('docs/security/compliance/rollback-browser-roles.sql','utf8'));
  await pg.exec('SET ROLE anon');
  assert.equal((await pg.query('SELECT * FROM internal.fixture')).rows.length,2,'Rollback restores captured access, no invented blanket grants');
  assert.equal((await pg.query('SELECT public.fixture_fn() AS n')).rows[0].n,1);
  await pg.exec('RESET ROLE');
  console.log('PASS: 72 browser role denials, backend helpers, future defaults, captured rollback; isolated PostgreSQL only.');
} finally {await pg.close();}
