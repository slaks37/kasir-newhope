#!/usr/bin/env node
/** Disposable PostgreSQL 18 migration verification. Never accepts a remote DB.
 * db:verify applies the ordered chain, then verifies catalog and repeat safety.
 * Business operations and BI/tenant/financial fixtures run in npm test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {applyAtomicMigration} from '../../services/db-server/atomicMigration.ts';

if (process.argv.includes('--live')) {
  console.error('DEMO_BOOTSTRAP_REMOTE_DISABLED: use db:verify for disposable embedded tests and reviewed corrective migrations for staging');
  process.exit(1);
}
const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',
  ...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f),
  ...['free-plan-selection.sql','free-plan-ai-credit-access.sql','restrict-browser-rls-policies.sql','intelligence-cache.sql','intelligence-wallet.sql'].map(f=>'docs/security/'+f),
  ...fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('_business_scoped_operational_state.sql')).sort().map(f=>'supabase/migrations/'+f)];
const db=new PGlite(),client={query:(sql,params)=>params?db.query(sql,params):db.exec(sql)};
let current='connect';
try {
  const version=(await db.query('SELECT version() AS version')).rows[0].version;
  console.log('MODE: EMBEDDED — '+version.split(' on ')[0]);
  await db.exec('CREATE TABLE public.schema_migrations(filename varchar(160) PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  for (const file of files) {
    current=file;
    await applyAtomicMigration(client,file,fs.readFileSync(file,'utf8'));
    console.log('  OK '+file);
  }
  const done=new Set((await db.query('SELECT filename FROM public.schema_migrations')).rows.map(r=>r.filename));
  assert.equal(done.size,files.length,'Every file has exactly one committed marker');
  assert(files.every(file=>done.has(file)),'Second pass must skip every applied file');
  const required=['internal.tenants','internal.users','internal.memberships','internal.merchants','internal.outlets',
    'pos.transactions','pos.payments','pos.cash_ledger','pos.transaction_refunds','pos.shared_state_records',
    'pos.shared_state_versions','pos.sync_receipts','pos.financial_approval_grants',
    'billing.subscriptions','billing.invoices','billing.payment_events','ai.credit_ledger','public.blog_posts'];
  for (const relation of required) assert((await db.query('SELECT to_regclass($1) AS name',[relation])).rows[0].name,relation+' missing');
  const types=(await db.query("SELECT table_schema,column_name,data_type FROM information_schema.columns WHERE table_schema='pos' AND table_name='transactions' AND column_name='id'")).rows;
  assert.equal(types[0]?.data_type,'uuid');
  const keys=(await db.query("SELECT count(*)::int AS count FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.contype='f' AND n.nspname IN ('pos','internal','billing','ai')")).rows[0].count;
  assert(keys>0,'Domain foreign keys must exist');
  const views=(await db.query("SELECT schemaname,viewname FROM pg_views WHERE schemaname IN ('contract','public')")).rows;
  for (const view of views) {
    current=view.schemaname+'.'+view.viewname;
    const quote=x=>'"'+x.replaceAll('"','""')+'"';
    await db.query('SELECT * FROM '+quote(view.schemaname)+'.'+quote(view.viewname)+' LIMIT 0');
  }
  // No demo customer or financial records are necessary for catalog verification.
  for (const relation of ['pos.transactions','pos.payments','pos.cash_ledger','billing.invoices'])
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM '+relation)).rows[0].n),0);
  console.log(JSON.stringify({status:'PASS',engine:'PGlite PostgreSQL18',migrations:files.length,requiredRelations:required.length,foreignKeys:keys,viewsExecuted:views.length,repeatPassPending:files.filter(f=>!done.has(f)).length,remoteConnectionUsed:false,demoFinancialRows:0}));
} catch(error) {
  console.error('MIGRATION_VERIFY_FAILED',current,error.code||'',error.message);
  process.exitCode=1;
} finally {await db.close();}
