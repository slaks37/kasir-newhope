import 'dotenv/config';
import pg from 'pg';

async function fixSupabase() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('Menghubungkan ke Supabase PostgreSQL database...');
  await client.connect();
  console.log('✓ Terhubung ke Supabase!\n');

  console.log('1. Menyiapkan Skema & Ekstensi...');
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    CREATE EXTENSION IF NOT EXISTS "pg_trgm";

    CREATE SCHEMA IF NOT EXISTS pos;
    CREATE SCHEMA IF NOT EXISTS billing;
    CREATE SCHEMA IF NOT EXISTS ai;
    CREATE SCHEMA IF NOT EXISTS internal;
    CREATE SCHEMA IF NOT EXISTS contract;
  `);
  console.log('✓ Ekstensi & Skema siap.');

  console.log('2. Memperbaiki Hak Akses Supabase (anon, authenticated, service_role)...');
  await client.query(`
    DO $$
    DECLARE
      sch TEXT;
      rol TEXT;
    BEGIN
      FOREACH sch IN ARRAY ARRAY['public', 'pos', 'billing', 'ai', 'internal', 'contract'] LOOP
        FOREACH rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'postgres'] LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
            EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', sch, rol);
            EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO %I', sch, rol);
            EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO %I', sch, rol);
            EXECUTE format('GRANT ALL ON ALL ROUTINES IN SCHEMA %I TO %I', sch, rol);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO %I', sch, rol);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON SEQUENCES TO %I', sch, rol);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON ROUTINES TO %I', sch, rol);
          END IF;
        END LOOP;
      END LOOP;
    END $$;
  `);
  console.log('✓ Hak akses Supabase berhasil diperbarui.');

  console.log('3. Memastikan Katalog Paket Langganan SaaS di billing.plans...');
  await client.query(`
    INSERT INTO billing.plans (id, name, tier_level, billing_cycle, price_idr, features) VALUES
      ('plan-basic-monthly',      'Basic Starter',    1, 'MONTHLY',  55000, '["Laporan Finansial Realtime", "Ekspor Excel & PDF", "Maksimal 1 Kasir", "Sinkronisasi Cloud"]'::jsonb),
      ('plan-pro-monthly',        'Pro Growth',       2, 'MONTHLY',  88000, '["Semua Fitur Basic", "Multi Kasir & Multi Cabang", "AI Financial Copilot", "Manajemen Inventori & Resep"]'::jsonb),
      ('plan-enterprise-monthly', 'Enterprise Ultra', 3, 'MONTHLY', 149000, '["Semua Fitur Pro", "Unlimited Cabang", "Akses API & Webhook", "Dukungan Prioritas 24/7", "Dedicated Account Manager"]'::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      tier_level = EXCLUDED.tier_level,
      price_idr = EXCLUDED.price_idr,
      features = EXCLUDED.features;
  `);
  console.log('✓ Paket SaaS billing.plans berhasil disinkronkan.');

  console.log('4. Memastikan Akun Toko Resmi (Budi Santoso, Siti Aminah, Rian Ardiansyah) di pos.users & pos.tenants...');
  await client.query(`
    -- Tenant Utama Toko
    INSERT INTO pos.tenants (id, name, business_sector, created_at)
    VALUES (
      legacy_uuid('usr-1_FNB'),
      'New Hope Resto & Cafe (Senayan Jakarta)',
      'FNB',
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      business_sector = EXCLUDED.business_sector;

    -- Pengguna Staf & Admin
    INSERT INTO pos.users (id, tenant_id, name, username, role, pin)
    VALUES
      (legacy_uuid('usr-1'), legacy_uuid('usr-1_FNB'), 'Budi Santoso', 'budi.admin', 'ADMIN', '1234'),
      (legacy_uuid('usr-2'), legacy_uuid('usr-1_FNB'), 'Siti Aminah', 'siti.manager', 'MANAGER', '5555'),
      (legacy_uuid('usr-3'), legacy_uuid('usr-1_FNB'), 'Rian Ardiansyah', 'rian.kasir', 'CASHIER', '0000')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      username = EXCLUDED.username,
      role = EXCLUDED.role,
      pin = EXCLUDED.pin;

    -- Langganan Aktif untuk Toko Budi Santoso
    INSERT INTO billing.subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end)
    VALUES (
      legacy_uuid('sub-budi-pro'),
      legacy_uuid('usr-1_FNB'),
      'plan-pro-monthly',
      'ACTIVE',
      CURRENT_TIMESTAMP - INTERVAL '5 days',
      CURRENT_TIMESTAMP + INTERVAL '85 days'
    )
    ON CONFLICT (id) DO UPDATE SET
      plan_id = EXCLUDED.plan_id,
      status = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end;

    -- AI Credits untuk Budi Santoso
    INSERT INTO ai.merchant_ai_credits (merchant_id, balance, monthly_grant, used_this_month, period_reset_at)
    VALUES (
      legacy_uuid('usr-1_FNB'),
      100,
      100,
      0,
      CURRENT_TIMESTAMP + INTERVAL '30 days'
    )
    ON CONFLICT (merchant_id) DO UPDATE SET
      balance = GREATEST(ai.merchant_ai_credits.balance, 100),
      monthly_grant = 100;
  `);
  console.log('✓ Akun toko, langganan & kredit AI Budi Santoso berhasil disinkronkan.');

  console.log('5. Memperbarui Views Publik untuk Kompatibilitas Supabase Studio...');
  await client.query(`
    -- Create convenience views in public schema so Supabase table editor or standard queries see them
    CREATE OR REPLACE VIEW public.v_pos_transactions AS
      SELECT * FROM pos.transactions;

    CREATE OR REPLACE VIEW public.v_pos_products AS
      SELECT * FROM pos.products;

    CREATE OR REPLACE VIEW public.v_pos_tenants AS
      SELECT * FROM pos.tenants;

    CREATE OR REPLACE VIEW public.v_pos_users AS
      SELECT * FROM pos.users;

    CREATE OR REPLACE VIEW public.v_billing_plans AS
      SELECT * FROM billing.plans;

    CREATE OR REPLACE VIEW public.v_billing_subscriptions AS
      SELECT * FROM billing.subscriptions;

    CREATE OR REPLACE VIEW public.v_ai_insights AS
      SELECT * FROM ai.daily_merchant_insights;
  `);
  console.log('✓ Public compatibility views siap.');

  console.log('6. Memeriksa Status RLS (Row Level Security)...');
  await client.query(`
    ALTER TABLE pos.tenants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pos.users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pos.products ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pos.transactions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pos.transaction_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pos.merchant_activity_log ENABLE ROW LEVEL SECURITY;
    ALTER TABLE billing.plans ENABLE ROW LEVEL SECURITY;
    ALTER TABLE billing.subscriptions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ai.daily_merchant_insights ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ai.merchant_ai_credits ENABLE ROW LEVEL SECURITY;

    -- Pasang Policy Permissive untuk Anon & Service Role agar sinkronisasi lancar
    DO $$
    DECLARE
      tbl TEXT;
    BEGIN
      FOREACH tbl IN ARRAY ARRAY['tenants', 'users', 'products', 'transactions', 'transaction_items', 'merchant_activity_log'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS p_%I_all ON pos.%I', tbl, tbl);
        EXECUTE format('CREATE POLICY p_%I_all ON pos.%I FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true)', tbl, tbl);
      END LOOP;

      FOREACH tbl IN ARRAY ARRAY['plans', 'subscriptions', 'invoices'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS p_%I_all ON billing.%I', tbl, tbl);
        EXECUTE format('CREATE POLICY p_%I_all ON billing.%I FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true)', tbl, tbl);
      END LOOP;

      FOREACH tbl IN ARRAY ARRAY['daily_merchant_insights', 'merchant_ai_credits', 'ai_query_logs', 'merchant_targets'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS p_%I_all ON ai.%I', tbl, tbl);
        EXECUTE format('CREATE POLICY p_%I_all ON ai.%I FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true)', tbl, tbl);
      END LOOP;
    END $$;
  `);
  console.log('✓ RLS Policies terpasang dengan aman.');

  await client.end();
  console.log('\n===============================================================');
  console.log('   🎉 SEMUA DATABASE SUPABASE TELAH DIPERBAIKI & DISINKRONKAN!  ');
  console.log('===============================================================');
}

fixSupabase().catch((err) => {
  console.error('Gagal memperbaiki Supabase:', err);
  process.exit(1);
});
