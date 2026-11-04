#!/usr/bin/env node
/**
 * =============================================================================
 * DATABASE BOOTSTRAP & VERIFICATION
 * =============================================================================
 * Applies every migration in order, seeds a demo tenant, runs the health job's
 * SQL, and asserts the BI views actually return rows.
 *
 *   npm run db:verify     embedded PostgreSQL 18 (PGlite) — no server needed
 *   npm run db:apply      against $DATABASE_URL (needs `pg` installed)
 *
 * The embedded mode exists so migrations are PROVEN to run before anyone points
 * them at a real cluster. "The SQL looks right" is not the same claim as
 * "PostgreSQL accepted it".
 * =============================================================================
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import 'dotenv/config';

const ROOT = process.cwd();
const MIGRATION_DIR = join(ROOT, 'migrations');

/** Base schemas first, then numbered migrations in order. */
// Same order as services/db-server/migrate.ts: compat shim, then base schemas.
const ORDER = ['migrations/0001_compat.sql', 'schema.sql', 'schema_hybrid_pos.sql'];

function migrationFiles() {
  const numbered = readdirSync(MIGRATION_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f !== '0001_compat.sql')
    .sort();
  return [
    ...ORDER.map((f) => ({ name: f, path: join(ROOT, f) })),
    ...numbered.map((f) => ({ name: f, path: join(MIGRATION_DIR, f) })),
    ...['free-plan-selection.sql','free-plan-ai-credit-access.sql','restrict-browser-rls-policies.sql','intelligence-cache.sql','intelligence-wallet.sql'].map(f=>({name:f,path:join(ROOT,'docs/security',f)})),
    ...readdirSync(join(ROOT,'supabase/migrations')).filter(f=>f.endsWith('_business_scoped_operational_state.sql')).sort().map(f=>({name:'supabase/migrations/'+f,path:join(ROOT,'supabase/migrations',f)})),
  ];
}

const log = (...a) => console.log(...a);

/* -------------------------------------------------------------------------- */
/* Seed — one healthy merchant, one lapsing, one dead                          */
/* -------------------------------------------------------------------------- */

const SEED_SQL = readFileSync(join(ROOT,'scripts/db/verification-fixture.sql'),'utf8');
const HEALTH_SQL = readFileSync(join(ROOT,'scripts/db/verification-health.sql'),'utf8');

/* -------------------------------------------------------------------------- */

async function run(exec, query) {
  const applied = [];
  for (const m of migrationFiles()) {
    let sql;
    try {
      sql = readFileSync(m.path, 'utf8');
    } catch {
      throw new Error(`Required migration missing: ${m.name}`);
    }
    try {
      await exec(sql);
      applied.push(m.name);
      log(`  OK    ${m.name}`);
    } catch (err) {
      log(`  FAIL  ${m.name}\n        ${String(err.message).split('\n')[0]}`);
      throw err;
    }
  }
  return applied;
}

async function verify(query) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const t = await query(`SELECT data_type FROM information_schema.columns
                          WHERE table_schema='pos' AND table_name='transactions' AND column_name='id'`);
  add('transactions.id is uuid', t.rows[0]?.data_type === 'uuid', t.rows[0]?.data_type);

  const inv = await query(`SELECT invoice_number FROM pos.transactions WHERE invoice_number IS NOT NULL LIMIT 1`);
  add('invoice_number stayed readable', /^INV-/.test(inv.rows[0]?.invoice_number || ''), inv.rows[0]?.invoice_number);

  const pl = await query(`SELECT data_type FROM information_schema.columns
                           WHERE table_schema='billing' AND table_name='plans' AND column_name='id'`);
  add('plans.id stayed readable code', ['character varying','text'].includes(pl.rows[0]?.data_type), pl.rows[0]?.data_type);

  const det = await query(`SELECT legacy_uuid('usr-1') a, legacy_uuid('usr-1') b, legacy_uuid('usr-2') c`);
  add('legacy_uuid deterministic', det.rows[0].a === det.rows[0].b && det.rows[0].a !== det.rows[0].c, det.rows[0].a);

  const fk = await query(`SELECT COUNT(*)::int n FROM pg_constraint WHERE contype='f'`);
  add('foreign keys restored', fk.rows[0].n > 0, `${fk.rows[0].n} FKs`);

  const h = await query(`SELECT merchant_id, churn_risk_score, days_since_last_txn, subscription_status,
                                mrr_idr, contract_mrr_idr
                           FROM contract.merchant_health_latest ORDER BY churn_risk_score DESC`);
  add('canonical merchant health returns rows', h.rows.length > 0, `${h.rows.length} merchants`);

  const banded = await query(`SELECT health_band, COUNT(*)::int n FROM contract.merchant_health_latest GROUP BY 1`);
  add('health bands computed', banded.rows.length > 0, banded.rows.map((r) => `${r.health_band}=${r.n}`).join(' '));

  const mrr = await query(`SELECT COALESCE(SUM(mrr_idr),0)::float recognised,
                                  COALESCE(SUM(contract_mrr_idr) FILTER (WHERE churn_risk_score >= 0.45),0)::float at_risk
                             FROM contract.merchant_health_latest`);
  add('MRR at risk is non-zero when merchants are lapsing',
      Number(mrr.rows[0].at_risk) > 0,
      `recognised=${mrr.rows[0].recognised} at_risk=${mrr.rows[0].at_risk}`);

  const ad = await query(`SELECT COUNT(*)::int n FROM contract.feature_adoption_30d`);
  add('canonical feature adoption returns rows', ad.rows[0].n > 0, `${ad.rows[0].n} features`);

  // Every Metabase dashboard card must actually run. Otherwise a broken card is
  // discovered by whoever opens the dashboard, not by CI.
  const cardSql = readFileSync(join(ROOT, 'scripts/db/metabase-cards.sql'), 'utf8');
  if (cardSql) {
    const statements = cardSql
      .split(';')
      .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
      .filter((s) => /^select/i.test(s));
    let bad = 0;
    for (const s of statements) {
      try {
        await query(s);
      } catch (e) {
        bad++;
        log(`        card failed: ${String(e.message).split('\n')[0]}`);
      }
    }
    add('metabase cards all execute', bad === 0 && statements.length === 8, `${statements.length - bad}/${statements.length} cards OK`);
  }

  return { checks, health: h.rows };
}

async function main() {
  const useLive = process.argv.includes('--live');
  const url = useLive ? (await import('../dev/rehearsal-target.mjs')).rehearsalTarget(process.env) : undefined;

  let exec, query, close;

  if (useLive && url) {
    const pg = (await import('pg')).default;
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    exec = (sql) => client.query(sql);
    query = (sql) => client.query(sql);
    close = () => client.end();
    const populated=await query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN('r','p','v','m','S')");
    if(populated.rows[0].n!==0){await close();throw Error('Disposable verification database must be empty');}
    log('MODE: DISPOSABLE POSTGRES17 REHEARSAL\n');
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = await PGlite.create();
    exec = (sql) => db.exec(sql);
    query = (sql) => db.query(sql);
    close = () => db.close();
    const v = await db.query('select version()');
    log(`MODE: EMBEDDED — ${v.rows[0].version.split(' on ')[0]}\n`);
  }

  try {
    log('APPLYING MIGRATIONS');
    await run(exec, query);

    log('\nSEEDING');
    await exec(SEED_SQL);
    const c = await query('SELECT COUNT(*)::int n FROM pos.transactions');
    log(`  OK    ${c.rows[0].n} transactions across 3 merchants`);

    log('\nCOMPUTING MERCHANT HEALTH');
    await exec(HEALTH_SQL);
    log('  OK    merchant_health_logs populated');
    const before=(await query('SELECT count(*)::int n,sum(total_amount)::text amount FROM contract.merchant_revenue')).rows[0];
    await exec(SEED_SQL);await exec(HEALTH_SQL);
    const after=(await query('SELECT count(*)::int n,sum(total_amount)::text amount FROM contract.merchant_revenue')).rows[0];
    if(before.n!==312||before.amount!==after.amount||before.n!==after.n)throw Error('Fixture replay changed canonical sales');
    log('  PASS  fixture replay preserves 312 canonical paid sales');

    log('\nVERIFYING');
    const { checks, health } = await verify(query);
    let failed = 0;
    for (const c2 of checks) {
      if (!c2.ok) failed++;
      log(`  ${c2.ok ? 'PASS' : 'FAIL'}  ${c2.name.padEnd(46)} ${c2.detail ?? ''}`);
    }

    log('\ncontract.merchant_health_latest  (what Metabase will show)');
    log('  ' + '-'.repeat(88));
    for (const r of health) {
      log(
        `  ${String(r.churn_risk_score).padStart(4)}  ${String(r.merchant_id).slice(0, 8)}…  ` +
          `${String(r.days_since_last_txn).padStart(3)}d idle  ${String(r.subscription_status || '-').padEnd(9)} ` +
          `MRR ${String(r.mrr_idr).padStart(9)}  kontrak ${String(r.contract_mrr_idr).padStart(9)}`
      );
    }
    log('  ' + '-'.repeat(88));

    if (failed > 0) {
      log(`\n${failed} check(s) FAILED`);
      process.exitCode = 1;
    } else {
      log(`\nAll ${checks.length} checks passed.`);
    }
  } finally {
    await close();
  }
}

main().catch((e) => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
