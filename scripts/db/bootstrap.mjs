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
const ORDER = ['schema_hybrid_pos.sql', 'schema.sql'];

function migrationFiles() {
  const numbered = readdirSync(MIGRATION_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  return [
    ...ORDER.map((f) => ({ name: f, path: join(ROOT, f) })),
    ...numbered.map((f) => ({ name: f, path: join(MIGRATION_DIR, f) })),
  ];
}

const log = (...a) => console.log(...a);

/* -------------------------------------------------------------------------- */
/* Seed — one healthy merchant, one lapsing, one dead                          */
/* -------------------------------------------------------------------------- */

const SEED_SQL = `
-- Plans are static config, not tenant data — their ids stay readable by design
-- (see THE RULE in 0005). schema.sql creates the table but seeds no rows.
INSERT INTO plans (id, name, tier_level, billing_cycle, price_idr, features) VALUES
  ('plan-basic-monthly',      'Basic Starter',    1, 'MONTHLY', 149000, '[]'::jsonb),
  ('plan-pro-monthly',        'Pro Growth',       2, 'MONTHLY', 349000, '[]'::jsonb),
  ('plan-enterprise-monthly', 'Enterprise Ultra', 3, 'MONTHLY', 699000, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO internal.tenants (id, name, business_sector, created_at) VALUES
  (legacy_uuid('tenant-warung'),  'Warung Sehat',   'FNB',     CURRENT_TIMESTAMP - INTERVAL '120 days'),
  (legacy_uuid('tenant-kopi'),    'Kopi Senja',     'FNB',     CURRENT_TIMESTAMP - INTERVAL '90 days'),
  (legacy_uuid('tenant-laundry'), 'Laundry Bersih', 'LAUNDRY', CURRENT_TIMESTAMP - INTERVAL '200 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, tenant_id, name, username, role, pin) VALUES
  (legacy_uuid('u-warung-1'),  legacy_uuid('tenant-warung'),  'Bu Sari',  'sari', 'ADMIN',   '1234'),
  (legacy_uuid('u-warung-2'),  legacy_uuid('tenant-warung'),  'Rina',     'rina', 'CASHIER', '1111'),
  (legacy_uuid('u-kopi-1'),    legacy_uuid('tenant-kopi'),    'Mas Anto', 'anto', 'ADMIN',   '2222'),
  (legacy_uuid('u-laundry-1'), legacy_uuid('tenant-laundry'), 'Pak Joko', 'joko', 'ADMIN',   '3333')
ON CONFLICT (id) DO NOTHING;

INSERT INTO subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end) VALUES
  (legacy_uuid('sub-warung'),  legacy_uuid('tenant-warung'),  'plan-pro-monthly',   'ACTIVE',
     CURRENT_TIMESTAMP - INTERVAL '10 days', CURRENT_TIMESTAMP + INTERVAL '20 days'),
  (legacy_uuid('sub-kopi'),    legacy_uuid('tenant-kopi'),    'plan-pro-monthly',   'PAST_DUE',
     CURRENT_TIMESTAMP - INTERVAL '40 days', CURRENT_TIMESTAMP - INTERVAL '10 days'),
  (legacy_uuid('sub-laundry'), legacy_uuid('tenant-laundry'), 'plan-basic-monthly', 'EXPIRED',
     CURRENT_TIMESTAMP - INTERVAL '70 days', CURRENT_TIMESTAMP - INTERVAL '40 days')
ON CONFLICT (id) DO NOTHING;

-- Warung: trading today. Kopi: went quiet 9 days ago. Laundry: 25 days silent.
INSERT INTO transactions (id, tenant_id, cashier_user_id, invoice_number, subtotal, total_amount, payment_method, payment_status, created_at)
SELECT uuidv7(), legacy_uuid('tenant-warung'), legacy_uuid('u-warung-2'),
       'INV-W-' || g, 150000 + (g * 137 % 90000), 150000 + (g * 137 % 90000), 'CASH', 'COMPLETED',
       CURRENT_TIMESTAMP - (g || ' hours')::interval
  FROM generate_series(1, 240) g;

INSERT INTO transactions (id, tenant_id, cashier_user_id, invoice_number, subtotal, total_amount, payment_method, payment_status, created_at)
SELECT uuidv7(), legacy_uuid('tenant-kopi'), legacy_uuid('u-kopi-1'),
       'INV-K-' || g, 45000 + (g * 91 % 30000), 45000 + (g * 91 % 30000), 'QRIS', 'COMPLETED',
       CURRENT_TIMESTAMP - INTERVAL '9 days' - (g || ' hours')::interval
  FROM generate_series(1, 60) g;

INSERT INTO transactions (id, tenant_id, cashier_user_id, invoice_number, subtotal, total_amount, payment_method, payment_status, created_at)
SELECT uuidv7(), legacy_uuid('tenant-laundry'), legacy_uuid('u-laundry-1'),
       'INV-L-' || g, 25000, 25000, 'CASH', 'COMPLETED',
       CURRENT_TIMESTAMP - INTERVAL '25 days' - (g || ' hours')::interval
  FROM generate_series(1, 12) g;

INSERT INTO feature_usage_events (merchant_id, tenant_id, business_id, feature_key, occurred_at)
SELECT legacy_uuid('tenant-warung'), legacy_uuid('tenant-warung'), 'warung_FNB', k,
       CURRENT_TIMESTAMP - (row_number() over () || ' hours')::interval
  FROM unnest(ARRAY['pos.checkout','ai.digest','ai.stock_critical','reports.margin','inventory.restock','crm.loyalty']) k;

INSERT INTO feature_usage_events (merchant_id, tenant_id, business_id, feature_key, occurred_at)
SELECT legacy_uuid('tenant-kopi'), legacy_uuid('tenant-kopi'), 'kopi_FNB', k,
       CURRENT_TIMESTAMP - INTERVAL '9 days'
  FROM unnest(ARRAY['pos.checkout','ai.digest']) k;
`;

/* -------------------------------------------------------------------------- */
/* Health computation — same model as the cron job and compute_churn_risk()     */
/* -------------------------------------------------------------------------- */

const HEALTH_SQL = `
INSERT INTO merchant_health_logs (
  id, merchant_id, tenant_id, log_date,
  daily_revenue, daily_transaction_count, active_cashiers_count,
  login_status, last_activity_at, days_since_last_txn, active_days_last_7,
  revenue_trend_pct, feature_usage_payload, distinct_features_used,
  support_tickets_count, subscription_status, mrr_idr, contract_mrr_idr,
  churn_risk_score, churn_risk_reasons
)
WITH agg AS (
  SELECT te.id AS merchant_id,
         MAX(t.created_at) AS last_txn_at,
         COUNT(t.id) FILTER (WHERE t.created_at::date = CURRENT_DATE)           AS txn_today,
         COALESCE(SUM(t.total_amount) FILTER (WHERE t.created_at::date = CURRENT_DATE), 0) AS rev_today,
         COUNT(DISTINCT t.cashier_user_id) FILTER (WHERE t.created_at::date = CURRENT_DATE) AS cashiers_today,
         COUNT(DISTINCT t.created_at::date) FILTER (WHERE t.created_at >= CURRENT_DATE - INTERVAL '7 days') AS active_days_7,
         COALESCE(SUM(t.total_amount) FILTER (WHERE t.created_at >= CURRENT_DATE - INTERVAL '7 days'), 0)  AS rev_7d,
         COALESCE(SUM(t.total_amount) FILTER (WHERE t.created_at <  CURRENT_DATE - INTERVAL '7 days'
                                               AND t.created_at >= CURRENT_DATE - INTERVAL '30 days'), 0)  AS rev_prior
    FROM internal.tenants te
    LEFT JOIN transactions t
           ON t.tenant_id = te.id AND t.payment_status = 'COMPLETED'
   GROUP BY te.id
),
feat AS (
  SELECT merchant_id,
         COUNT(DISTINCT feature_key) AS n,
         jsonb_object_agg(feature_key, uses) AS payload
    FROM (SELECT merchant_id, feature_key, COUNT(*) uses
            FROM feature_usage_events
           WHERE occurred_at >= CURRENT_DATE - INTERVAL '30 days'
           GROUP BY 1,2) x
   GROUP BY merchant_id
),
calc AS (
  SELECT a.*,
         COALESCE(f.n, 0) AS features,
         COALESCE(f.payload, '{}'::jsonb) AS payload,
         s.status AS sub_status,
         COALESCE(p.price_idr, 0) AS plan_price,
         COALESCE(EXTRACT(DAY FROM (CURRENT_TIMESTAMP - a.last_txn_at))::int, 999) AS days_since,
         CASE WHEN a.rev_prior > 0
              THEN (((a.rev_7d / 7.0) - (a.rev_prior / 23.0)) / (a.rev_prior / 23.0)) * 100
              ELSE 0 END AS trend_pct
    FROM agg a
    LEFT JOIN subscriptions s ON s.tenant_id = a.merchant_id
    LEFT JOIN plans p ON p.id = s.plan_id
    LEFT JOIN feat f ON f.merchant_id = a.merchant_id
)
SELECT uuidv7(), c.merchant_id, c.merchant_id, CURRENT_DATE,
       c.rev_today, c.txn_today, c.cashiers_today,
       (c.days_since <= 1), c.last_txn_at, LEAST(c.days_since, 999)::int, LEAST(c.active_days_7, 7)::int,
       ROUND(c.trend_pct, 2), c.payload, c.features::int,
       0, c.sub_status,
       CASE WHEN c.sub_status = 'ACTIVE' THEN c.plan_price ELSE 0 END,
       CASE WHEN c.sub_status IS NOT NULL AND c.sub_status <> 'CANCELED' THEN c.plan_price ELSE 0 END,
       compute_churn_risk(LEAST(c.days_since, 999)::int, LEAST(c.active_days_7, 7)::int,
                          ROUND(c.trend_pct, 2)::numeric, c.sub_status::varchar,
                          c.features::int, 0::int),
       '[]'::jsonb
  FROM calc c
ON CONFLICT (merchant_id, log_date) DO UPDATE SET
  daily_revenue = EXCLUDED.daily_revenue,
  churn_risk_score = EXCLUDED.churn_risk_score,
  updated_at = CURRENT_TIMESTAMP;
`;

/* -------------------------------------------------------------------------- */

async function run(exec, query) {
  const applied = [];
  for (const m of migrationFiles()) {
    let sql;
    try {
      sql = readFileSync(m.path, 'utf8');
    } catch {
      log(`  SKIP  ${m.name} (not found)`);
      continue;
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
                          WHERE table_name='transactions' AND column_name='id'`);
  add('transactions.id is uuid', t.rows[0]?.data_type === 'uuid', t.rows[0]?.data_type);

  const inv = await query(`SELECT invoice_number FROM transactions WHERE invoice_number IS NOT NULL LIMIT 1`);
  add('invoice_number stayed readable', /^INV-/.test(inv.rows[0]?.invoice_number || ''), inv.rows[0]?.invoice_number);

  const pl = await query(`SELECT data_type FROM information_schema.columns
                           WHERE table_name='plans' AND column_name='id'`);
  add('plans.id stayed readable code', pl.rows[0]?.data_type !== 'uuid', pl.rows[0]?.data_type);

  const det = await query(`SELECT legacy_uuid('usr-1') a, legacy_uuid('usr-1') b, legacy_uuid('usr-2') c`);
  add('legacy_uuid deterministic', det.rows[0].a === det.rows[0].b && det.rows[0].a !== det.rows[0].c, det.rows[0].a);

  const fk = await query(`SELECT COUNT(*)::int n FROM pg_constraint WHERE contype='f'`);
  add('foreign keys restored', fk.rows[0].n > 0, `${fk.rows[0].n} FKs`);

  const h = await query(`SELECT merchant_id, churn_risk_score, days_since_last_txn, subscription_status,
                                mrr_idr, contract_mrr_idr
                           FROM v_merchant_health_latest ORDER BY churn_risk_score DESC`);
  add('v_merchant_health_latest returns rows', h.rows.length > 0, `${h.rows.length} merchants`);

  const banded = await query(`SELECT health_band, COUNT(*)::int n FROM v_merchant_health_latest GROUP BY 1`);
  add('health bands computed', banded.rows.length > 0, banded.rows.map((r) => `${r.health_band}=${r.n}`).join(' '));

  const mrr = await query(`SELECT COALESCE(SUM(mrr_idr),0)::float recognised,
                                  COALESCE(SUM(contract_mrr_idr) FILTER (WHERE churn_risk_score >= 0.45),0)::float at_risk
                             FROM v_merchant_health_latest`);
  add('MRR at risk is non-zero when merchants are lapsing',
      Number(mrr.rows[0].at_risk) > 0,
      `recognised=${mrr.rows[0].recognised} at_risk=${mrr.rows[0].at_risk}`);

  const ad = await query(`SELECT COUNT(*)::int n FROM v_feature_adoption_30d`);
  add('v_feature_adoption_30d returns rows', ad.rows[0].n > 0, `${ad.rows[0].n} features`);

  // Every Metabase dashboard card must actually run. Otherwise a broken card is
  // discovered by whoever opens the dashboard, not by CI.
  let cardSql = '';
  try {
    cardSql = readFileSync(join(ROOT, 'scripts/db/metabase-cards.sql'), 'utf8');
  } catch {
    cardSql = '';
  }
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
    add('metabase cards all execute', bad === 0, `${statements.length - bad}/${statements.length} cards OK`);
  }

  return { checks, health: h.rows };
}

async function main() {
  const useLive = process.argv.includes('--live');
  const url = process.env.DATABASE_URL;

  let exec, query, close;

  if (useLive && url) {
    const pg = (await import('pg')).default;
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    exec = (sql) => client.query(sql);
    query = (sql) => client.query(sql);
    close = () => client.end();
    log(`MODE: LIVE — ${url.replace(/:[^:@]*@/, ':***@')}\n`);
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
    const c = await query('SELECT COUNT(*)::int n FROM transactions');
    log(`  OK    ${c.rows[0].n} transactions across 3 merchants`);

    log('\nCOMPUTING MERCHANT HEALTH');
    await exec(HEALTH_SQL);
    log('  OK    merchant_health_logs populated');

    log('\nVERIFYING');
    const { checks, health } = await verify(query);
    let failed = 0;
    for (const c2 of checks) {
      if (!c2.ok) failed++;
      log(`  ${c2.ok ? 'PASS' : 'FAIL'}  ${c2.name.padEnd(46)} ${c2.detail ?? ''}`);
    }

    log('\nv_merchant_health_latest  (what Metabase will show)');
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
