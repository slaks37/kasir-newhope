-- 0041_subscription_hardening.sql
-- Hardening: 15-day trial enforcement, one-time trial lock, and reminder tracking

ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS has_used_trial boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS billing.reminder_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES internal.tenants(id),
  channel text NOT NULL CHECK (channel IN ('WHATSAPP', 'EMAIL')),
  stage text NOT NULL,
  days_left integer NOT NULL,
  recipient text NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'SENT',
  external_id text
);

ALTER TABLE billing.reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing.reminder_deliveries FROM PUBLIC;
