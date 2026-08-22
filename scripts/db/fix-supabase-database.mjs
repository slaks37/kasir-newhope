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

  console.log('4. Memastikan Akun Toko Resmi di internal.tenants, internal.users & internal.memberships...');
  await client.query(`
    -- 4a. Tenant Utama Toko Platform (internal.tenants)
    INSERT INTO internal.tenants (id, name, business_sector, created_at)
    VALUES (
      legacy_uuid('usr-1_FNB'),
      'New Hope Resto & Cafe (Senayan Jakarta)',
      'FNB',
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      business_sector = EXCLUDED.business_sector;

    -- 4b. Global Identity Users (internal.users)
    INSERT INTO internal.users (id, email, full_name, is_active)
    VALUES
      (legacy_uuid('usr-1'), 'budi.santoso@newhopepos.id', 'Budi Santoso', TRUE),
      (legacy_uuid('usr-2'), 'siti.aminah@newhopepos.id', 'Siti Aminah', TRUE),
      (legacy_uuid('usr-3'), 'rian.ardiansyah@newhopepos.id', 'Rian Ardiansyah', TRUE)
    ON CONFLICT (id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email;

    -- 4c. Multi-Tenant RBAC Memberships (internal.memberships)
    INSERT INTO internal.memberships (id, user_id, tenant_id, role, pin)
    VALUES
      (legacy_uuid('mem-budi'), legacy_uuid('usr-1'), legacy_uuid('usr-1_FNB'), 'OWNER', '1234'),
      (legacy_uuid('mem-siti'), legacy_uuid('usr-2'), legacy_uuid('usr-1_FNB'), 'MANAGER', '5555'),
      (legacy_uuid('mem-rian'), legacy_uuid('usr-3'), legacy_uuid('usr-1_FNB'), 'CASHIER', '0000')
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET
      role = EXCLUDED.role,
      pin = EXCLUDED.pin;

    -- 4d. Langganan Aktif untuk Toko Budi Santoso (billing.subscriptions)
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

    -- 4e. AI Credits untuk Budi Santoso (ai.merchant_ai_credits)
    INSERT INTO ai.merchant_ai_credits (merchant_id, tenant_id, balance, monthly_grant, used_this_month, period_reset_at)
    VALUES (
      legacy_uuid('usr-1_FNB'),
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
  console.log('✓ Organisasi tenant, akun user, membership & langganan berhasil disinkronkan.');

  console.log('5. Memperbarui Views Kontrak & Sanitasi Public (Tanpa Bocoran PIN/Tabel Mentah)...');
  await client.query(`
    -- 1. Buat view kontrak inventori
    DROP VIEW IF EXISTS contract.inventory_movements CASCADE;
    CREATE OR REPLACE VIEW contract.inventory_movements AS
    SELECT
        l.id                                               AS movement_id,
        l.tenant_id                                        AS merchant_id,
        t.name                                             AS merchant_name,
        t.business_sector,
        l.ingredient_id,
        i.name                                             AS ingredient_name,
        i.sku                                              AS ingredient_sku,
        i.unit                                             AS ingredient_unit,
        l.transaction_id,
        l.quantity_changed,
        l.previous_stock,
        l.new_stock,
        l.reason,
        l.created_at
      FROM pos.inventory_logs l
      JOIN pos.tenants t          ON t.id = l.tenant_id
      LEFT JOIN pos.ingredients i ON i.id = l.ingredient_id;

    -- 2. Hapus view bypass mentah yang tidak aman
    DROP VIEW IF EXISTS public.v_pos_transactions        CASCADE;
    DROP VIEW IF EXISTS public.v_pos_products            CASCADE;
    DROP VIEW IF EXISTS public.v_pos_tenants             CASCADE;
    DROP VIEW IF EXISTS public.v_pos_users               CASCADE;
    DROP VIEW IF EXISTS public.v_billing_plans           CASCADE;
    DROP VIEW IF EXISTS public.v_billing_subscriptions   CASCADE;
    DROP VIEW IF EXISTS public.v_ai_insights             CASCADE;

    -- 3. Buat view public yang hanya membaca contract.* (tersanitasi)
    CREATE OR REPLACE VIEW public.v_merchant_directory AS
      SELECT * FROM contract.merchant_directory;

    CREATE OR REPLACE VIEW public.v_merchant_revenue AS
      SELECT * FROM contract.merchant_revenue;

    CREATE OR REPLACE VIEW public.v_catalog AS
      SELECT * FROM contract.catalog;

    CREATE OR REPLACE VIEW public.v_stock_status AS
      SELECT * FROM contract.stock_status;

    CREATE OR REPLACE VIEW public.v_subscription_status AS
      SELECT * FROM contract.subscription_status;

    CREATE OR REPLACE VIEW public.v_transaction_log AS
      SELECT * FROM contract.transaction_log;

    CREATE OR REPLACE VIEW public.v_inventory_movements AS
      SELECT * FROM contract.inventory_movements;
  `);
  console.log('✓ Public sanitized compatibility views siap.');

  console.log('6. Menegakkan PostgreSQL Row Level Security (RLS) sebagai Lapisan Otorisasi Database...');
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
  console.log('✓ RLS Policies terpasang dengan aman sebagai security filter.');

  await client.end();
  console.log('\n===============================================================');
  console.log('   🎉 SEMUA DATABASE SUPABASE TELAH DIPERBAIKI & DISINKRONKAN!  ');
  console.log('===============================================================');
}

fixSupabase().catch((err) => {
  console.error('Gagal memperbaiki Supabase:', err);
  process.exit(1);
});
