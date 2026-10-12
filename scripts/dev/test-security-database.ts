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
  assert.equal((await pg.query<{n:number}>('SELECT public.fixture_fn() AS n')).rows[0].n,1,'PUBLIC helper preserved explicitly for backend');
  await pg.exec('RESET ROLE');
  await pg.exec('CREATE TABLE pos.future_fixture(id int); CREATE FUNCTION public.future_fn() RETURNS int LANGUAGE sql AS $$SELECT 2$$;');
  for(const role of ['anon','authenticated']){
    assert.equal((await pg.query<{allowed:boolean}>('SELECT has_table_privilege($1,$2,$3) AS allowed',[role,'pos.future_fixture','SELECT'])).rows[0].allowed,false);
    assert.equal((await pg.query<{allowed:boolean}>('SELECT has_function_privilege($1,$2,$3) AS allowed',[role,'public.future_fn()','EXECUTE'])).rows[0].allowed,false);
  }
  await pg.exec(fs.readFileSync('docs/security/compliance/rollback-browser-roles.sql','utf8'));
  await pg.exec('SET ROLE anon');
  assert.equal((await pg.query('SELECT * FROM internal.fixture')).rows.length,2,'Rollback restores captured access, no invented blanket grants');
  assert.equal((await pg.query<{n:number}>('SELECT public.fixture_fn() AS n')).rows[0].n,1);
  await pg.exec('RESET ROLE');
  console.log('PASS: 72 browser role denials, backend helpers, future defaults, captured rollback; isolated PostgreSQL only.');
} finally {await pg.close();}

// Repeat against the real repository schema, not only synthetic ACL fixtures.
const actual=new PGlite();
try {
  await actual.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;');
  const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f)];
  for(const file of files)await actual.exec(fs.readFileSync(file,'utf8'));
  await actual.exec(migration);
  const relations=(await actual.query<{schema_name:string;relation_name:string}>(`SELECT n.nspname schema_name,c.relname relation_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','pos','internal','billing','ai','contract') AND c.relkind IN('r','p','v','m','f')`)).rows;
  for(const role of ['anon','authenticated']){
    for(const r of relations){
      await actual.exec('SET ROLE '+role);
      await assert.rejects(()=>actual.query('SELECT * FROM "'+r.schema_name+'"."'+r.relation_name+'" LIMIT 0'),/permission denied/);
      await actual.exec('RESET ROLE');
    }
    const residual=await actual.query<{n:number}>(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','pos','internal','billing','ai','contract') AND c.relkind IN('r','p','v','m','f') AND (has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege($1,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))`,[role]);
    assert.equal(residual.rows[0].n,0,'No residual real-schema relation/column privilege');
  }
  // Known backend login is preserved; without tenant context its RLS rows stay hidden.
  await actual.exec('SET ROLE svc_pos');await actual.query('SELECT * FROM pos.transactions LIMIT 0');await actual.exec('RESET ROLE');
  console.log('PASS: real repository schema '+relations.length+' relations deny both browser roles; backend relation dependency remains.');
}finally{await actual.close();}
