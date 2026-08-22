import 'dotenv/config';
import pg from 'pg';

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('Connecting to Supabase PostgreSQL...');
  await client.connect();
  console.log('✓ Connected successfully!\n');

  console.log('Executing Full Relational ERD Schema in public...');

  const ddl = `
  -- Enable extensions
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  CREATE EXTENSION IF NOT EXISTS "pg_trgm";

  -- =========================================================================
  -- 1. SAAS PLANS & SUBSCRIPTIONS (BILLING DOMAIN)
  -- =========================================================================
  CREATE TABLE IF NOT EXISTS public.saas_plans (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    tier_level INT NOT NULL DEFAULT 1,
    billing_cycle VARCHAR(32) NOT NULL DEFAULT 'MONTHLY',
    price_idr NUMERIC(15,2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'IDR',
    features JSONB NOT NULL DEFAULT '[]'::jsonb,
    max_outlets INT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- =========================================================================
  -- 2. PLATFORM ADMIN & SUPERUSERS
  -- =========================================================================
  CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(150) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'ROLE_SUPERADMIN',
    password_hash VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- =========================================================================
  -- 3. MERCHANTS / TENANTS (CLIENT ORGANIZATIONS)
  -- =========================================================================
  CREATE TABLE IF NOT EXISTS public.merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) UNIQUE,
    name VARCHAR(255) NOT NULL,
    business_sector VARCHAR(50) NOT NULL DEFAULT 'FNB',
    tagline VARCHAR(255),
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(120),
    logo_url TEXT,
    monthly_revenue_target NUMERIC(15,2) DEFAULT 50000000,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- =========================================================================
  -- 4. MERCHANT SETTINGS & BRANCHES
  -- =========================================================================
  CREATE TABLE IF NOT EXISTS public.merchant_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL UNIQUE REFERENCES public.merchants(id) ON DELETE CASCADE,
    enable_tax BOOLEAN NOT NULL DEFAULT true,
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    enable_service BOOLEAN NOT NULL DEFAULT false,
    service_rate NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    currency_symbol VARCHAR(10) NOT NULL DEFAULT 'Rp',
    receipt_header TEXT,
    receipt_footer TEXT,
    auto_print_receipt BOOLEAN NOT NULL DEFAULT false,
    loyalty_earn_rate NUMERIC(15,2) NOT NULL DEFAULT 10000,
    loyalty_redeem_rate NUMERIC(15,2) NOT NULL DEFAULT 100,
    geofence_enforcement VARCHAR(32) NOT NULL DEFAULT 'FLEXIBLE',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS public.store_branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    address TEXT,
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),
    allowed_radius_meters INT NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- =========================================================================
  -- 5. SAAS SUBSCRIPTIONS & INVOICES
  -- =========================================================================
  CREATE TABLE IF NOT EXISTS public.saas_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    plan_id VARCHAR(64) NOT NULL REFERENCES public.saas_plans(id),
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    current_period_end TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days'),
    grace_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
    canceled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS public.saas_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES public.saas_subscriptions(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    invoice_number VARCHAR(64) NOT NULL UNIQUE,
    amount NUMERIC(15,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'IDR',
    payment_status VARCHAR(32) NOT NULL DEFAULT 'PAID',
    payment_gateway_ref VARCHAR(120),
    payment_link_url TEXT,
    paid_at TIMESTAMPTZ,
    due_date TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- =========================================================================
  -- 6. CLIENT APP USERS & SHIFTS
  -- =========================================================================
  CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.store_branches(id) ON DELETE SET NULL,
    name VARCHAR(150) NOT NULL,
    username VARCHAR(80) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'CASHIER',
    pin VARCHAR(10) NOT NULL DEFAULT '1234',
    email VARCHAR(120),
    phone VARCHAR(50),
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    avatar TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_merchant_username UNIQUE(business_id, username)
  );

  CREATE TABLE IF NOT EXISTS public.user_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    cashier_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    cashier_name VARCHAR(150) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMPTZ,
    initial_cash NUMERIC(15,2) NOT NULL DEFAULT 0,
    cash_sales NUMERIC(15,2) NOT NULL DEFAULT 0,
    qris_sales NUMERIC(15,2) NOT NULL DEFAULT 0,
    card_sales NUMERIC(15,2) NOT NULL DEFAULT 0,
    ewallet_sales NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_sales NUMERIC(15,2) NOT NULL DEFAULT 0,
    expected_cash NUMERIC(15,2) NOT NULL DEFAULT 0,
    actual_cash NUMERIC(15,2),
    difference NUMERIC(15,2),
    total_orders INT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS public.staff_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'Barista',
    sector VARCHAR(50) NOT NULL DEFAULT 'FNB',
    avatar TEXT,
    is_available BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS public.attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    staff_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.store_branches(id) ON DELETE SET NULL,
    clock_in_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    clock_out_time TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'CLOCKED_IN',
    clock_in_latitude NUMERIC(10,7),
    clock_in_longitude NUMERIC(10,7),
    is_within_radius BOOLEAN DEFAULT true,
    shift_notes TEXT
  );

  -- =========================================================================
  -- 7. CATEGORIES, PRODUCTS, VARIANTS & MODIFIERS
  -- =========================================================================
  CREATE TABLE IF NOT EXISTS public.categories (
    id VARCHAR(64) PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    icon VARCHAR(64) DEFAULT 'Package',
    color VARCHAR(64) DEFAULT 'bg-amber-500',
    business_sector VARCHAR(50) DEFAULT 'FNB',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS public.products (
    id VARCHAR(64) PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    category_id VARCHAR(64) REFERENCES public.categories(id) ON DELETE SET NULL,
    sku VARCHAR(64) NOT NULL,
    barcode VARCHAR(64),
    name VARCHAR(200) NOT NULL,
    price NUMERIC(15,2) NOT NULL DEFAULT 0,
    cost_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    stock INT NOT NULL DEFAULT 0,
    min_stock_alert INT NOT NULL DEFAULT 5,
    unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
    image TEXT,
    description TEXT,
    is_available BOOLEAN NOT NULL DEFAULT true,
    business_sector VARCHAR(50) DEFAULT 'FNB',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS public.product_variants (
    id VARCHAR(64) PRIMARY KEY,
    product_id VARCHAR(64) NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    price_extra NUMERIC(15,2) NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS public.product_modifiers (
    id VARCHAR(64) PRIMARY KEY,
    product_id VARCHAR(64) NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    group_name VARCHAR(100) NOT NULL,
    option_name VARCHAR(100) NOT NULL,
    price_extra NUMERIC(15,2) NOT NULL DEFAULT 0,
    is_required BOOLEAN NOT NULL DEFAULT false
  );

  -- =========================================================================
  -- 8. RAW MATERIALS / INGREDIENTS & RECIPES (BILL OF MATERIALS)
  -- =========================================================================
  CREATE TABLE IF NOT EXISTS public.raw_materials (
    id VARCHAR(64) PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    sku VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(32) NOT NULL DEFAULT 'BAHAN_BAKU', -- 'BAHAN_BAKU', 'SETENGAH_JADI', 'JADI'
    stock NUMERIC(15,3) NOT NULL DEFAULT 0,
    min_stock_alert NUMERIC(15,3) NOT NULL DEFAULT 10,
    unit VARCHAR(32) NOT NULL DEFAULT 'Gram',
    cost_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    location VARCHAR(150) DEFAULT 'Gudang Utama',
    supplier VARCHAR(150),
    recipe_yield TEXT,
    notes TEXT,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS public.product_recipes (
    id VARCHAR(64) PRIMARY KEY,
    product_id VARCHAR(64) NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    raw_material_id VARCHAR(64) NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    quantity NUMERIC(15,3) NOT NULL DEFAULT 1,
    unit VARCHAR(32) NOT NULL DEFAULT 'Gram',
    cost_per_unit NUMERIC(15,2) NOT NULL DEFAULT 0,
    subtotal_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- =========================================================================
  -- 9. PRODUCT BUNDLES (COMBO PROMO SETS)
  -- =========================================================================
  CREATE TABLE IF NOT EXISTS public.product_bundles (
    id VARCHAR(64) PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    sku VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    image TEXT,
    regular_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    bundle_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    is_available BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS public.bundle_items (
    id VARCHAR(64) PRIMARY KEY,
    bundle_id VARCHAR(64) NOT NULL REFERENCES public.product_bundles(id) ON DELETE CASCADE,
    product_id VARCHAR(64) NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    quantity INT NOT NULL DEFAULT 1,
    unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    subtotal_price NUMERIC(15,2) NOT NULL DEFAULT 0
  );

  -- =========================================================================
  -- 10. CUSTOMERS, LOYALTY & PROMOS
  -- =========================================================================
  CREATE TABLE IF NOT EXISTS public.customers (
    id VARCHAR(64) PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(120),
    points INT NOT NULL DEFAULT 0,
    tier VARCHAR(32) NOT NULL DEFAULT 'BRONZE',
    total_spent NUMERIC(15,2) NOT NULL DEFAULT 0,
    visit_count INT NOT NULL DEFAULT 1,
    last_visit TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS public.promo_codes (
    code VARCHAR(64) PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    max_discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    min_purchase_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- =========================================================================
  -- 11. ORDERS, ITEMS, TAXES & PAYMENTS (TRANSACTIONS DOMAIN)
  -- =========================================================================
  CREATE TABLE IF NOT EXISTS public.orders (
    id VARCHAR(64) PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.store_branches(id) ON DELETE SET NULL,
    shift_id UUID REFERENCES public.user_shifts(id) ON DELETE SET NULL,
    cashier_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    customer_id VARCHAR(64) REFERENCES public.customers(id) ON DELETE SET NULL,
    order_number INT NOT NULL,
    date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    order_type VARCHAR(32) NOT NULL DEFAULT 'DINE_IN',
    table_name VARCHAR(50),
    cashier_name VARCHAR(150) NOT NULL,
    subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
    discount_total NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_total NUMERIC(15,2) NOT NULL DEFAULT 0,
    service_charge_total NUMERIC(15,2) NOT NULL DEFAULT 0,
    total NUMERIC(15,2) NOT NULL DEFAULT 0,
    payment_method VARCHAR(32) NOT NULL DEFAULT 'CASH',
    payment_status VARCHAR(32) NOT NULL DEFAULT 'PAID',
    cash_received NUMERIC(15,2),
    change_amount NUMERIC(15,2),
    qris_ref VARCHAR(120),
    status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS public.order_items (
    id VARCHAR(64) PRIMARY KEY,
    order_id VARCHAR(64) NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id VARCHAR(64) REFERENCES public.products(id) ON DELETE SET NULL,
    product_name VARCHAR(200) NOT NULL,
    variant_name VARCHAR(100),
    unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    unit_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
    quantity INT NOT NULL DEFAULT 1,
    discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_price NUMERIC(15,2) NOT NULL DEFAULT 0,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS public.order_tax_breakdowns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id VARCHAR(64) NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    tax_type VARCHAR(32) NOT NULL DEFAULT 'PB1', -- 'PB1', 'PPN', 'SERVICE_CHARGE'
    rate_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    taxable_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS public.inventory_logs (
    id VARCHAR(64) PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    product_id VARCHAR(64) REFERENCES public.products(id) ON DELETE SET NULL,
    raw_material_id VARCHAR(64) REFERENCES public.raw_materials(id) ON DELETE SET NULL,
    item_name VARCHAR(200) NOT NULL,
    type VARCHAR(32) NOT NULL, -- 'IN', 'OUT', 'ADJUSTMENT', 'SALE', 'REFUND'
    quantity NUMERIC(15,3) NOT NULL,
    previous_stock NUMERIC(15,3) NOT NULL,
    new_stock NUMERIC(15,3) NOT NULL,
    reason TEXT,
    actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    actor_name VARCHAR(150),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- =========================================================================
  -- 12. AI FINANCIAL COPILOT & EXECUTIVE INSIGHTS
  -- =========================================================================
  CREATE TABLE IF NOT EXISTS public.ai_merchant_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    headline VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'REVENUE', 'INVENTORY', 'CHURN', 'ANOMALY'
    impact_level VARCHAR(32) NOT NULL DEFAULT 'HIGH', -- 'HIGH', 'MEDIUM', 'LOW'
    confidence_score NUMERIC(5,2) DEFAULT 0.95,
    details TEXT,
    recommendation TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS public.merchant_health_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    score INT NOT NULL DEFAULT 85,
    risk_level VARCHAR(32) NOT NULL DEFAULT 'HEALTHY',
    churn_probability NUMERIC(5,2) DEFAULT 0.05,
    daily_avg_gmv NUMERIC(15,2) DEFAULT 0,
    daily_avg_tx_count INT DEFAULT 0,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    target_merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `;

  await client.query(ddl);
  console.log('✓ All 22 relational tables and foreign keys successfully created in public schema!');

  console.log('\nPopulating initial seeds & syncing data...');

  const seedQuery = `
  -- 1. SaaS Plans
  INSERT INTO public.saas_plans (id, name, tier_level, billing_cycle, price_idr, currency, features, max_outlets)
  VALUES
    ('plan-basic-monthly', 'Basic Starter', 1, 'MONTHLY', 55000, 'IDR', '["Laporan Finansial Realtime", "Ekspor Excel & PDF", "Maksimal 1 Kasir", "Sinkronisasi Cloud"]'::jsonb, 1),
    ('plan-pro-monthly', 'Pro Growth', 2, 'MONTHLY', 88000, 'IDR', '["Semua Fitur Basic", "Multi Kasir & Multi Cabang", "AI Financial Copilot", "Manajemen Inventori & Resep", "Bundling Promo"]'::jsonb, 3),
    ('plan-enterprise-monthly', 'Enterprise Ultra', 3, 'MONTHLY', 149000, 'IDR', '["Semua Fitur Pro", "Unlimited Cabang", "Akses API & Webhook", "Dukungan Prioritas 24/7", "Dedicated Account Manager"]'::jsonb, 10)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price_idr = EXCLUDED.price_idr,
    features = EXCLUDED.features;

  -- 2. Platform Admin Superusers
  INSERT INTO public.admin_users (id, email, full_name, role, is_active)
  VALUES
    ('019ffd94-f2d0-7df7-83fe-45bcfb33d64f', 'stefenlaksana.sl@gmail.com', 'Stefen Laksana (Superadmin)', 'ROLE_SUPERADMIN', true),
    ('8830a284-f30d-5057-a457-abc6cfd678bc', 'ops@newhopepos.id', 'Platform Root Operator', 'ROLE_SUPERADMIN', true)
  ON CONFLICT (email) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role;

  -- 3. Merchants across multiple sectors
  INSERT INTO public.merchants (id, code, name, business_sector, tagline, address, phone, monthly_revenue_target)
  VALUES
    ('a0000000-0000-0000-0000-000000000001', 'MCH-FNB-01', 'Kopi Kenangan Senopati', 'FNB', 'Kopi Indonesia Berkualitas Tinggi', 'Jl. Senopati No. 45, Jakarta Selatan', '081299887766', 150000000),
    ('a0000000-0000-0000-0000-000000000002', 'MCH-FNB-02', 'New Hope Resto & Cafe', 'FNB', 'Authentic Taste & Modern POS Experience', 'Senayan City Lt. LG, Jakarta', '081122334455', 60000000),
    ('a0000000-0000-0000-0000-000000000003', 'MCH-LDR-01', 'Laundry Kilat Dago', 'LAUNDRY', 'Cuci Bersih Wangi 3 Jam Selesai', 'Jl. Ir. H. Djuanda No. 112, Bandung', '081377889900', 10000000),
    ('a0000000-0000-0000-0000-000000000004', 'MCH-CW-01', 'Auto Clean Carwash Express', 'CARWASH', 'Cuci Salju Hidrolik & Detailing Cepat', 'Jl. Panjang No. 88, Kebon Jeruk, Jakarta', '081566778899', 40000000),
    ('a0000000-0000-0000-0000-000000000005', 'MCH-BAR-01', 'Gentlemen Cut Barbershop', 'BARBERSHOP', 'Premium Haircut, Shaving & Pomade Styling', 'Jl. Kemang Raya No. 12, Jakarta', '081677889922', 25000000),
    ('a0000000-0000-0000-0000-000000000006', 'MCH-RET-01', 'Toko Berkah Sembako Retail', 'RETAIL', 'Kebutuhan Harian Murah & Lengkap', 'Pasar Minggu Blok B No. 4, Jakarta', '081855443322', 75000000)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    business_sector = EXCLUDED.business_sector,
    monthly_revenue_target = EXCLUDED.monthly_revenue_target;

  -- 4. Merchant Settings
  INSERT INTO public.merchant_settings (business_id, enable_tax, tax_rate, enable_service, service_rate)
  SELECT id, true, 10.00, true, 5.00 FROM public.merchants
  ON CONFLICT (business_id) DO NOTHING;

  -- 5. Branches
  INSERT INTO public.store_branches (id, business_id, name, address, latitude, longitude, allowed_radius_meters)
  VALUES
    ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Cabang Senopati Utama', 'Jl. Senopati No. 45', -6.2297, 106.8074, 100),
    ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Cabang Senayan City Mall', 'Senayan City LG-08', -6.2270, 106.7972, 100)
  ON CONFLICT (id) DO NOTHING;

  -- 6. Subscriptions
  INSERT INTO public.saas_subscriptions (id, business_id, plan_id, status)
  VALUES
    ('20000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'plan-enterprise-monthly', 'ACTIVE'),
    ('20000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'plan-pro-monthly', 'ACTIVE'),
    ('20000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'plan-basic-monthly', 'ACTIVE'),
    ('20000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'plan-pro-monthly', 'ACTIVE'),
    ('20000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005', 'plan-pro-monthly', 'ACTIVE'),
    ('20000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000006', 'plan-pro-monthly', 'ACTIVE')
  ON CONFLICT (id) DO NOTHING;

  -- 7. Client Users
  INSERT INTO public.users (id, business_id, name, username, role, pin, email)
  VALUES
    ('30000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'Budi Santoso', 'budi.admin', 'ADMIN', '1234', 'budi@newhopepos.id'),
    ('30000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Siti Aminah', 'siti.manager', 'MANAGER', '5555', 'siti@newhopepos.id'),
    ('30000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'Rian Ardiansyah', 'rian.kasir', 'CASHIER', '0000', 'rian@newhopepos.id')
  ON CONFLICT (business_id, username) DO UPDATE SET
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    pin = EXCLUDED.pin;

  -- 8. Categories
  INSERT INTO public.categories (id, business_id, name, icon, color, business_sector)
  VALUES
    ('cat-makanan', 'a0000000-0000-0000-0000-000000000002', 'Makanan Utama', 'Utensils', 'bg-amber-500', 'FNB'),
    ('cat-minuman', 'a0000000-0000-0000-0000-000000000002', 'Minuman & Kopi', 'CupSoda', 'bg-emerald-500', 'FNB'),
    ('cat-snack',   'a0000000-0000-0000-0000-000000000002', 'Snack & Pastry', 'Pizza', 'bg-rose-500', 'FNB')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

  -- 9. Products
  INSERT INTO public.products (id, business_id, category_id, sku, name, price, cost_price, stock, min_stock_alert, unit, image)
  VALUES
    ('prod-1', 'a0000000-0000-0000-0000-000000000002', 'cat-makanan', 'SKU-NG-01', 'Nasi Goreng Spesial', 25000, 12000, 50, 10, 'porsi', 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Food/Steaming%20Bowl.png'),
    ('prod-2', 'a0000000-0000-0000-0000-000000000002', 'cat-makanan', 'SKU-MG-02', 'Mie Goreng Telur', 22000, 10000, 45, 10, 'porsi', 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Food/Spaghetti.png'),
    ('prod-5', 'a0000000-0000-0000-0000-000000000002', 'cat-minuman', 'SKU-ESP-01', 'Es Kopi Susu Gula Aren', 18000, 8000, 80, 15, 'cup', 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Food/Hot%20Beverage.png'),
    ('prod-6', 'a0000000-0000-0000-0000-000000000002', 'cat-minuman', 'SKU-TEA-01', 'Es Teh Manis Segar', 8000, 2500, 100, 20, 'cup', 'https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Food/Teacup%20Without%20Handle.png')
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    cost_price = EXCLUDED.cost_price,
    stock = EXCLUDED.stock;

  -- 10. Raw Materials (Bahan Baku & Mentah)
  INSERT INTO public.raw_materials (id, business_id, sku, name, type, stock, min_stock_alert, unit, cost_price, location)
  VALUES
    ('raw-coffee-bean', 'a0000000-0000-0000-0000-000000000002', 'RAW-COFFEE-01', 'Biji Kopi Arabica Gayo Roasted', 'BAHAN_BAKU', 25000, 2000, 'Gram', 160, 'Gudang Kering Bar'),
    ('raw-fresh-milk',   'a0000000-0000-0000-0000-000000000002', 'RAW-MILK-01', 'Susu Segar Pasteurisasi Diamond', 'BAHAN_BAKU', 50000, 5000, 'ml', 20, 'Kulkas Pendingin Bar'),
    ('raw-aren-sugar',  'a0000000-0000-0000-0000-000000000002', 'RAW-AREN-01', 'Gula Aren Cair Organik', 'BAHAN_BAKU', 20000, 2000, 'ml', 25, 'Gudang Kering Bar'),
    ('raw-plastic-cup', 'a0000000-0000-0000-0000-000000000002', 'RAW-CUP-01', 'Cup Plastik PET 16oz + Tutup Seal', 'BAHAN_BAKU', 500, 50, 'pcs', 650, 'Rak Kemasan Bar')
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    cost_price = EXCLUDED.cost_price,
    stock = EXCLUDED.stock;

  -- 11. Product Recipes (BOM Linking Multiple Ingredients)
  INSERT INTO public.product_recipes (id, product_id, raw_material_id, business_id, quantity, unit, cost_per_unit, subtotal_cost)
  VALUES
    ('rec-esp-1', 'prod-5', 'raw-coffee-bean', 'a0000000-0000-0000-0000-000000000002', 18, 'Gram', 160, 2880),
    ('rec-esp-2', 'prod-5', 'raw-fresh-milk',   'a0000000-0000-0000-0000-000000000002', 150, 'ml', 20, 3000),
    ('rec-esp-3', 'prod-5', 'raw-aren-sugar',  'a0000000-0000-0000-0000-000000000002', 25, 'ml', 25, 625),
    ('rec-esp-4', 'prod-5', 'raw-plastic-cup', 'a0000000-0000-0000-0000-000000000002', 1, 'pcs', 650, 650)
  ON CONFLICT (id) DO UPDATE SET
    quantity = EXCLUDED.quantity,
    subtotal_cost = EXCLUDED.subtotal_cost;

  -- 12. Product Bundling (Paket Combo Sets)
  INSERT INTO public.product_bundles (id, business_id, sku, name, description, regular_price, bundle_price, discount_percent)
  VALUES
    ('bun-1', 'a0000000-0000-0000-0000-000000000002', 'BUN-KENYANG-01', 'Paket Kenyang Hemat (Nasi Goreng + Es Kopi)', '1x Nasi Goreng Spesial + 1x Es Kopi Susu Aren', 43000, 35000, 18.6),
    ('bun-2', 'a0000000-0000-0000-0000-000000000002', 'BUN-SARAPAN-01', 'Paket Sarapan Santai (Mie Goreng + Es Teh)', '1x Mie Goreng Telur + 1x Es Teh Manis Segar', 30000, 25000, 16.7)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    bundle_price = EXCLUDED.bundle_price,
    discount_percent = EXCLUDED.discount_percent;

  INSERT INTO public.bundle_items (id, bundle_id, product_id, quantity, unit_price, subtotal_price)
  VALUES
    ('bi-1-1', 'bun-1', 'prod-1', 1, 25000, 25000),
    ('bi-1-2', 'bun-1', 'prod-5', 1, 18000, 18000),
    ('bi-2-1', 'bun-2', 'prod-2', 1, 22000, 22000),
    ('bi-2-2', 'bun-2', 'prod-6', 1, 8000, 8000)
  ON CONFLICT (id) DO UPDATE SET
    quantity = EXCLUDED.quantity,
    subtotal_price = EXCLUDED.subtotal_price;

  -- 13. AI Merchant Insights & Health Scores
  INSERT INTO public.ai_merchant_insights (business_id, headline, category, impact_level, details, recommendation)
  VALUES
    ('a0000000-0000-0000-0000-000000000001', 'Kopi Kenangan Senopati Cetak Rekor Omzet Tertinggi Rp 184,5 Juta', 'REVENUE', 'HIGH', 'Kontribusi GMV merchant mencapai 38.6% dari total ekosistem dengan margin bersih 55%.', 'Beri insentif loyalitas & reward program ekspansi multi-cabang.'),
    ('a0000000-0000-0000-0000-000000000003', 'Laundry Kilat Dago Masuk Kategori At-Risk (Omzet Rendah)', 'CHURN', 'HIGH', 'Omzet bulan ini Rp 4,2 Juta jauh di bawah target Rp 10 Juta dengan margin tipis 35%.', 'Aktifkan promo bundling cuci kilat + parfum laundry premium via WhatsApp blast.')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.merchant_health_scores (business_id, score, risk_level, churn_probability, daily_avg_gmv, daily_avg_tx_count)
  VALUES
    ('a0000000-0000-0000-0000-000000000001', 98, 'HEALTHY', 0.02, 6150000, 128),
    ('a0000000-0000-0000-0000-000000000002', 91, 'HEALTHY', 0.04, 2980000, 68),
    ('a0000000-0000-0000-0000-000000000003', 42, 'CRITICAL', 0.48, 140000, 8),
    ('a0000000-0000-0000-0000-000000000004', 86, 'HEALTHY', 0.07, 1860000, 32),
    ('a0000000-0000-0000-0000-000000000005', 88, 'HEALTHY', 0.05, 1240000, 24),
    ('a0000000-0000-0000-0000-000000000006', 84, 'HEALTHY', 0.09, 3100000, 45)
  ON CONFLICT (id) DO NOTHING;
  `;

  await client.query(seedQuery);
  console.log('✓ Initial seed data successfully inserted and mapped!');

  console.log('\nConfiguring Supabase Permissions & Grants...');
  await client.query(`
    DO $$
    DECLARE
      rol TEXT;
    BEGIN
      FOREACH rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'postgres'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
          EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', rol);
          EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA public TO %I', rol);
          EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO %I', rol);
          EXECUTE format('GRANT ALL ON ALL ROUTINES IN SCHEMA public TO %I', rol);
          EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO %I', rol);
          EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO %I', rol);
          EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO %I', rol);
        END IF;
      END LOOP;
    END $$;
  `);
  console.log('✓ Permissions successfully granted.');

  await client.end();
  console.log('\n🎉 ALL DONE! Supabase public schema now contains the complete relational ERD model!');
}

main().catch((err) => {
  console.error('Fatal error during setup:', err);
  process.exit(1);
});
