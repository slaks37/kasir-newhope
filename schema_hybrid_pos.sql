-- PostgreSQL Schema Migration Script for Hybrid Multi-Tenant POS Platform
-- Includes Bill of Materials (BOM) Recipe Stock Deduction & Analytics Indexes

-- 1. Tenants & Users (Multi-Tenancy & Access Control)
CREATE TABLE tenants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    business_sector VARCHAR(32) NOT NULL DEFAULT 'FNB',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    username VARCHAR(50) NOT NULL,
    pin VARCHAR(64) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'CASHIER', -- ADMIN, MANAGER, CASHIER
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT idx_tenant_username UNIQUE(tenant_id, username)
);

-- 2. Raw Materials & Ingredients (Inventory Management)
CREATE TABLE ingredients (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    sku VARCHAR(50),
    current_stock NUMERIC(12, 3) NOT NULL DEFAULT 0,
    min_stock_alert NUMERIC(12, 3) NOT NULL DEFAULT 10,
    unit VARCHAR(20) NOT NULL, -- gram, ml, pcs, kg, porsi
    cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Products Catalog
CREATE TABLE products (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    sku VARCHAR(50) NOT NULL,
    category_id VARCHAR(64),
    price NUMERIC(12, 2) NOT NULL,
    cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Bill of Materials (Product Recipe Mapping BOM)
CREATE TABLE product_recipes (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    ingredient_id VARCHAR(64) NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    quantity_required NUMERIC(12, 3) NOT NULL, -- e.g. 100g beras per 1 nasi goreng
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT idx_product_ingredient UNIQUE(product_id, ingredient_id)
);

-- 5. Financial Transactions & Line Items
CREATE TABLE transactions (
    id VARCHAR(64) PRIMARY KEY, -- e.g. INV-20260811-001
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    cashier_user_id VARCHAR(64) NOT NULL REFERENCES users(id),
    subtotal NUMERIC(12, 2) NOT NULL,
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(12, 2) NOT NULL,
    payment_method VARCHAR(20) NOT NULL, -- CASH, QRIS, CARD, EDC
    payment_status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transaction_items (
    id VARCHAR(64) PRIMARY KEY,
    transaction_id VARCHAR(64) NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL,
    product_id VARCHAR(64) NOT NULL REFERENCES products(id),
    product_name VARCHAR(100) NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL,
    quantity INT NOT NULL,
    total_price NUMERIC(12, 2) NOT NULL
);

-- 6. Inventory Deduction Log Audit Trail
CREATE TABLE inventory_logs (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    ingredient_id VARCHAR(64) NOT NULL REFERENCES ingredients(id),
    transaction_id VARCHAR(64) REFERENCES transactions(id),
    quantity_changed NUMERIC(12, 3) NOT NULL, -- negative value for deduction
    previous_stock NUMERIC(12, 3) NOT NULL,
    new_stock NUMERIC(12, 3) NOT NULL,
    reason VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- High-Performance Analytics Indexes
CREATE INDEX idx_transactions_tenant_date ON transactions(tenant_id, created_at DESC);
CREATE INDEX idx_transaction_items_tenant_product ON transaction_items(tenant_id, product_id);
CREATE INDEX idx_inventory_logs_tenant_ingredient ON inventory_logs(tenant_id, ingredient_id, created_at DESC);
