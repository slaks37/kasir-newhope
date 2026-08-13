-- PostgreSQL / Supabase Schema Migration Script for SaaS Subscription Engine
-- New Hope POS SaaS Multi-Tenant Architecture

-- 1. Enum Types for Subscription & Payment Status
CREATE TYPE billing_cycle_enum AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE subscription_status_enum AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELED');
CREATE TYPE payment_status_enum AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- 2. Plans Table
CREATE TABLE plans (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    tier_level INT NOT NULL DEFAULT 1, -- 1: Basic, 2: Pro, 3: Enterprise
    billing_cycle billing_cycle_enum NOT NULL DEFAULT 'MONTHLY',
    price_idr NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'IDR',
    features JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Subscriptions Table
CREATE TABLE subscriptions (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    plan_id VARCHAR(64) NOT NULL REFERENCES plans(id),
    status subscription_status_enum NOT NULL DEFAULT 'TRIAL',
    current_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    grace_period_end TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    canceled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tenant UNIQUE(tenant_id)
);

-- 4. Invoices / Transactions Table
CREATE TABLE invoices (
    id VARCHAR(64) PRIMARY KEY,
    subscription_id VARCHAR(64) NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'IDR',
    payment_status payment_status_enum NOT NULL DEFAULT 'PENDING',
    payment_gateway_ref VARCHAR(128),
    payment_link_url TEXT,
    paid_at TIMESTAMP WITH TIME ZONE,
    due_date TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Webhook Logs Table (For Idempotency)
CREATE TABLE webhook_logs (
    id VARCHAR(64) PRIMARY KEY,
    event_id VARCHAR(128) NOT NULL UNIQUE,
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for High Performance Lookup
CREATE INDEX idx_subscriptions_tenant_status ON subscriptions(tenant_id, status);
CREATE INDEX idx_invoices_subscription ON invoices(subscription_id);
CREATE INDEX idx_invoices_tenant ON invoices(tenant_id);
