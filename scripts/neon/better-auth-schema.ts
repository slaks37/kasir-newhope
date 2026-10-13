import fs from 'node:fs';
import pg from 'pg';
import {getMigrations} from 'better-auth/db/migration';
import {stagingTarget} from './better-target.mjs';
const {env,...transport}=stagingTarget();
Object.assign(process.env,env,{DATABASE_URL:transport.connectionString});
const {createBetterAuthRuntime}=await import('../../services/shared/betterAuth');
const runtime=createBetterAuthRuntime();
const client=new pg.Client(transport);
try {
  await client.connect();
  const objects=await client.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='newhope_auth'");
  if(objects.rows.length)throw Error('REFUSE_EXISTING_AUTH_SCHEMA');
  const migration=await getMigrations(runtime.auth.options);
  if(migration.unsafeChanges.length||migration.schemaProblems.length)throw Error('UNSAFE_AUTH_SCHEMA');
  const sql='-- Generated from pinned Better Auth 1.7.7; isolated child branch only.\nCREATE SCHEMA newhope_auth;\n'+await migration.compileMigrations();
  const file='neon/migrations/0002_better_auth_core.sql';
  const applying=process.argv.includes('--apply');
  if(applying && fs.readFileSync(file,'utf8')!==sql+'\n')throw Error('GENERATED_SCHEMA_CHANGED_REVIEW_REQUIRED');
  if(!applying)fs.writeFileSync(file,sql+'\n');
  // Generation is read-only. Review saved SQL before --apply.
  if(applying) {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(fs.readFileSync('neon/migrations/0003_better_auth_evidence.sql','utf8'));
    await client.query(fs.readFileSync('neon/migrations/0004_better_auth_identity_provider.sql','utf8'));
    await client.query('COMMIT');
    console.log('PASS: reviewed Better Auth schema applied to isolated MFA child branch');
  }else console.log('Generated auth SQL for review; no auth schema writes');
}finally{await client.end();await runtime.close();}
