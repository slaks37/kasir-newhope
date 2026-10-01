-- Canonical financial facts. Operational JSON is never a sales or cash ledger.
ALTER TABLE pos.transaction_items ADD COLUMN IF NOT EXISTS client_item_id text;
-- Keep the historical integer column for dependent legacy views. All canonical
-- consumers use this exact quantity (laundry kg), falling back for older rows.
ALTER TABLE pos.transaction_items ADD COLUMN IF NOT EXISTS quantity_exact numeric(12,3) CHECK(quantity_exact > 0);
ALTER TABLE pos.payments ADD COLUMN IF NOT EXISTS client_payment_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_client ON pos.payments(transaction_id,client_payment_id) WHERE client_payment_id IS NOT NULL;
ALTER TABLE pos.transactions ADD COLUMN IF NOT EXISTS client_shift_id text;
ALTER TABLE pos.shifts ADD COLUMN IF NOT EXISTS client_shift_id text;
ALTER TABLE pos.shifts ADD COLUMN IF NOT EXISTS actor_name text;
ALTER TABLE pos.shifts ADD COLUMN IF NOT EXISTS summary jsonb;
ALTER TABLE pos.shifts ADD COLUMN IF NOT EXISTS notes text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_client ON pos.shifts(tenant_id,client_shift_id) WHERE client_shift_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_items_client ON pos.transaction_items(transaction_id,client_item_id)
  WHERE client_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pos.transaction_refunds (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES internal.tenants(id),
  merchant_id uuid NOT NULL REFERENCES internal.merchants(id),
  outlet_id uuid NOT NULL REFERENCES internal.outlets(id),
  transaction_id uuid NOT NULL REFERENCES pos.transactions(id),
  client_refund_id text NOT NULL,
  command jsonb,
  amount numeric(12,2) NOT NULL CHECK(amount > 0),
  subtotal_amount numeric(12,2) NOT NULL CHECK(subtotal_amount >= 0),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(discount_amount >= 0),
  tax_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(tax_amount >= 0),
  service_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(service_amount >= 0),
  refund_method text NOT NULL CHECK(refund_method IN ('CASH','ORIGINAL_METHOD')),
  reason text NOT NULL,
  actor_ref text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,client_refund_id)
);
CREATE TABLE IF NOT EXISTS pos.transaction_refund_items (
  refund_id uuid NOT NULL REFERENCES pos.transaction_refunds(id),
  transaction_item_id uuid NOT NULL REFERENCES pos.transaction_items(id),
  quantity numeric(12,3) NOT NULL CHECK(quantity > 0),
  amount numeric(12,2) NOT NULL CHECK(amount >= 0),
  PRIMARY KEY(refund_id,transaction_item_id)
);
CREATE TABLE IF NOT EXISTS pos.cash_ledger (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES internal.tenants(id),
  merchant_id uuid NOT NULL REFERENCES internal.merchants(id),
  outlet_id uuid NOT NULL REFERENCES internal.outlets(id),
  client_event_id text NOT NULL,
  command jsonb,
  event_type text NOT NULL CHECK(event_type IN ('SALE','VOID','REFUND','CASH_IN','CASH_OUT','OPENING','REVERSAL')),
  amount numeric(12,2) NOT NULL,
  transaction_id uuid REFERENCES pos.transactions(id),
  reference_id text,
  note text NOT NULL DEFAULT '',
  category text,
  recipient_or_source text,
  actor_ref text,
  actor_name text,
  shift_ref text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,client_event_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_reversal_once ON pos.cash_ledger(tenant_id,reference_id)
  WHERE event_type='REVERSAL';
CREATE INDEX IF NOT EXISTS idx_cash_scope_time ON pos.cash_ledger(tenant_id,merchant_id,outlet_id,occurred_at);
CREATE INDEX IF NOT EXISTS idx_refund_tx ON pos.transaction_refunds(transaction_id);
CREATE INDEX IF NOT EXISTS idx_refund_item ON pos.transaction_refund_items(transaction_item_id);
CREATE INDEX IF NOT EXISTS idx_tx_report_scope ON pos.transactions(tenant_id,merchant_id,outlet_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_payment_coverage ON pos.payments(transaction_id,payment_status);

CREATE OR REPLACE FUNCTION pos.reject_financial_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Financial ledger is append-only; use a compensating entry' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION pos.reject_financial_ledger_mutation() FROM PUBLIC;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['transaction_refunds','transaction_refund_items','cash_ledger'] LOOP
    EXECUTE format('ALTER TABLE pos.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('REVOKE ALL ON pos.%I FROM PUBLIC,anon,authenticated',tab);
    EXECUTE format('DROP TRIGGER IF EXISTS immutable_financial_record ON pos.%I',tab);
    EXECUTE format('CREATE TRIGGER immutable_financial_record BEFORE UPDATE OR DELETE ON pos.%I
      FOR EACH ROW EXECUTE FUNCTION pos.reject_financial_ledger_mutation()',tab);
    EXECUTE format('DROP TRIGGER IF EXISTS immutable_financial_truncate ON pos.%I',tab);
    EXECUTE format('CREATE TRIGGER immutable_financial_truncate BEFORE TRUNCATE ON pos.%I
      FOR EACH STATEMENT EXECUTE FUNCTION pos.reject_financial_ledger_mutation()',tab);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='svc_pos') THEN
      EXECUTE format('GRANT SELECT,INSERT ON pos.%I TO svc_pos',tab);
      EXECUTE format('DROP POLICY IF EXISTS financial_pos_scope ON pos.%I',tab);
      IF tab='transaction_refund_items' THEN
        EXECUTE format('CREATE POLICY financial_pos_scope ON pos.%I TO svc_pos USING
          (EXISTS(SELECT 1 FROM pos.transaction_refunds r WHERE r.id=refund_id))
          WITH CHECK(EXISTS(SELECT 1 FROM pos.transaction_refunds r WHERE r.id=refund_id))',tab);
      ELSE
        EXECUTE format('CREATE POLICY financial_pos_scope ON pos.%I TO svc_pos USING
          (tenant_id::text=current_setting(''app.tenant_id'',true) AND merchant_id::text=current_setting(''app.merchant_id'',true))
          WITH CHECK(tenant_id::text=current_setting(''app.tenant_id'',true) AND merchant_id::text=current_setting(''app.merchant_id'',true))',tab);
      END IF;
    END IF;

  END LOOP;
END $$;

-- Preserve the deployed view's column order (some installations retain the
-- historical transaction_id alias). CREATE OR REPLACE preserves dependants/grants.
DO $$ DECLARE alias_prefix text; BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_attribute
    WHERE attrelid='contract.merchant_revenue'::regclass AND attname='transaction_id' AND NOT attisdropped)
    THEN 'x.id AS transaction_id,' ELSE '' END INTO alias_prefix;
  EXECUTE format($view$
  CREATE OR REPLACE VIEW contract.merchant_revenue WITH(security_invoker=false) AS
  SELECT %s x.id,x.tenant_id,x.merchant_id,m.name AS merchant_name,x.outlet_id,o.name AS outlet_name,
    x.invoice_number,x.business_sector,x.business_id,x.app_module,x.order_type,
    (CASE WHEN p.method_count>1 THEN 'SPLIT' ELSE COALESCE(p.payment_method,x.payment_method) END)::varchar AS payment_method,
    x.order_status,'PAID'::varchar AS payment_status,
    x.subtotal,x.discount_amount,x.tax_amount,x.service_charge_amount,
    GREATEST(x.total_amount-COALESCE(r.amount,0),0)::numeric(12,2) AS total_amount,
    x.created_at,
    x.total_amount AS gross_total_amount,
    COALESCE(r.amount,0)::numeric(12,2) AS refund_amount,
    p.collected_amount,
    COALESCE(cost.cogs_amount,0) AS cogs_amount,
    GREATEST(x.tax_amount-COALESCE(r.tax,0),0)::numeric(12,2) AS net_tax_amount,
    GREATEST(x.discount_amount-COALESCE(r.discount,0),0)::numeric(12,2) AS net_discount_amount
  FROM pos.transactions x
  JOIN internal.merchants m ON m.id=x.merchant_id
  LEFT JOIN internal.outlets o ON o.id=x.outlet_id
  JOIN LATERAL (
    SELECT SUM(amount) AS collected_amount, MIN(payment_method) AS payment_method,
      COUNT(DISTINCT payment_method) AS method_count,COUNT(*) AS payment_count
    FROM pos.payments WHERE transaction_id=x.id AND tenant_id=x.tenant_id
      AND payment_status IN ('PAID','SETTLED')
  ) p ON p.payment_count>0 AND p.collected_amount>=x.total_amount
  LEFT JOIN LATERAL(SELECT SUM(amount) AS amount,SUM(tax_amount) AS tax,SUM(discount_amount) AS discount FROM pos.transaction_refunds
    WHERE transaction_id=x.id AND tenant_id=x.tenant_id) r ON true
  LEFT JOIN LATERAL(
    SELECT SUM(i.unit_cost*GREATEST(COALESCE(i.quantity_exact,i.quantity)-COALESCE(ri.qty,0),0)) AS cogs_amount
    FROM pos.transaction_items i LEFT JOIN LATERAL(
      SELECT SUM(quantity) AS qty FROM pos.transaction_refund_items WHERE transaction_item_id=i.id
    ) ri ON true WHERE i.transaction_id=x.id
  ) cost ON true
  WHERE x.order_status IN ('COMPLETED','SETTLED','REFUNDED')
    AND COALESCE(x.payment_status,'') NOT IN ('CANCELLED','VOIDED','FAILED')
  $view$,alias_prefix);
END $$;
COMMENT ON VIEW contract.merchant_revenue IS
  'Canonical net sales by original sale date: completed/settled orders fully covered by PAID/SETTLED payments (including split tender), less append-only refunds. Void/cancel excluded; full refund retained at zero.';

-- Do not multiply sales by the number of outlets, or include voids in directory.
CREATE OR REPLACE VIEW contract.merchant_directory WITH(security_invoker=false) AS
SELECT m.id AS merchant_id,m.tenant_id,t.name AS tenant_name,m.name AS merchant_name,
  m.business_sector,m.external_ref AS business_id,m.is_active,m.created_at AS joined_at,
  o.outlet_count,r.transaction_count,r.gross_revenue,r.last_transaction_at
FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id
LEFT JOIN LATERAL(SELECT count(*) AS outlet_count FROM internal.outlets WHERE merchant_id=m.id AND tenant_id=m.tenant_id AND is_active) o ON true
LEFT JOIN LATERAL(SELECT count(*) AS transaction_count,COALESCE(sum(total_amount),0) AS gross_revenue,max(created_at) AS last_transaction_at
  FROM contract.merchant_revenue WHERE merchant_id=m.id AND tenant_id=m.tenant_id) r ON true;
CREATE OR REPLACE VIEW contract.admin_sector_summary WITH(security_invoker=false) AS
SELECT business_sector,count(DISTINCT merchant_id)::int AS merchant_count,count(DISTINCT business_id)::int AS business_unit_count,
  count(*)::int AS transaction_count,COALESCE(sum(total_amount),0) AS gross_revenue,COALESCE(avg(total_amount),0) AS avg_basket,
  COALESCE(sum(net_discount_amount),0) AS total_discount,max(created_at) AS last_transaction_at
FROM contract.merchant_revenue GROUP BY business_sector;
CREATE OR REPLACE VIEW contract.admin_product_sales WITH(security_invoker=false) AS
SELECT r.business_sector,r.merchant_id,m.name AS merchant_name,i.product_id,i.product_name,i.category_name,
  max(i.product_description) AS product_description,sum(GREATEST(COALESCE(i.quantity_exact,i.quantity)-COALESCE(ret.qty,0),0))::bigint AS units_sold,
  sum(GREATEST(i.total_price-COALESCE(ret.amount,0),0)) AS revenue,
  sum(i.unit_cost*GREATEST(COALESCE(i.quantity_exact,i.quantity)-COALESCE(ret.qty,0),0)) AS cogs,
  sum(GREATEST(i.total_price-COALESCE(ret.amount,0),0)-i.unit_cost*GREATEST(COALESCE(i.quantity_exact,i.quantity)-COALESCE(ret.qty,0),0)) AS gross_profit,
  count(DISTINCT i.transaction_id) AS appeared_in_transactions,max(r.created_at) AS last_sold_at,
  sum(GREATEST(COALESCE(i.quantity_exact,i.quantity)-COALESCE(ret.qty,0),0)) AS units_sold_exact
FROM pos.transaction_items i JOIN contract.merchant_revenue r ON r.id=i.transaction_id
JOIN internal.merchants m ON m.id=r.merchant_id
LEFT JOIN LATERAL(SELECT sum(quantity) AS qty,sum(amount) AS amount FROM pos.transaction_refund_items WHERE transaction_item_id=i.id) ret ON true
GROUP BY r.business_sector,r.merchant_id,m.name,i.product_id,i.product_name,i.category_name;

-- Backfill only authoritative CASH payments, never operational JSON.
INSERT INTO pos.cash_ledger(tenant_id,merchant_id,outlet_id,client_event_id,event_type,amount,transaction_id,note,occurred_at)
SELECT p.tenant_id,p.merchant_id,p.outlet_id,'payment:'||p.id,'SALE',p.amount,p.transaction_id,
  'Verified cash payment',COALESCE(p.paid_at,p.created_at)
FROM pos.payments p JOIN pos.transactions x ON x.id=p.transaction_id
WHERE p.payment_method='CASH' AND p.payment_status IN ('PAID','SETTLED')
  AND x.order_status NOT IN ('VOIDED','CANCELLED','REFUNDED')
  AND p.tenant_id IS NOT NULL AND p.merchant_id IS NOT NULL AND p.outlet_id IS NOT NULL
ON CONFLICT(tenant_id,client_event_id) DO NOTHING;

-- Private service contracts intentionally keep their existing owner-executed
-- boundary: AI/admin have no raw POS grants. Browser roles cannot access them;
-- authenticated ownership checks remain mandatory at every HTTP entry point.
CREATE OR REPLACE VIEW contract.refund_totals WITH(security_invoker=false) AS
SELECT tenant_id,merchant_id,outlet_id,transaction_id,SUM(amount) AS amount,
  SUM(subtotal_amount) AS subtotal,SUM(discount_amount) AS discount,SUM(tax_amount) AS tax,SUM(service_amount) AS service
FROM pos.transaction_refunds GROUP BY tenant_id,merchant_id,outlet_id,transaction_id;
CREATE OR REPLACE VIEW contract.transaction_items_detailed WITH(security_invoker=false) AS
SELECT ti.id AS item_id,ti.transaction_id,t.invoice_number,t.tenant_id,t.merchant_id,m.name AS merchant_name,
  m.business_sector,t.outlet_id,o.name AS outlet_name,ti.product_id,
  COALESCE(ti.product_name_snapshot,ti.product_name) AS product_name,ti.category_name,ti.variant_id,
  ti.variant_name_snapshot AS variant_name,ti.sku_snapshot AS sku,ti.unit_price,ti.unit_cost,ti.quantity,
  ti.subtotal,ti.discount_amount,ti.total_price,
  ROUND((ti.total_price-ti.unit_cost*COALESCE(ti.quantity_exact,ti.quantity))::numeric,2) AS gross_profit,
  ti.modifier_snapshot,ti.notes,t.created_at AS transaction_at,
  COALESCE(ti.quantity_exact,ti.quantity) AS quantity_exact,
  GREATEST(COALESCE(ti.quantity_exact,ti.quantity)-COALESCE(ret.quantity,0),0) AS quantity_remaining,
  GREATEST(ti.total_price-COALESCE(ret.amount,0),0) AS remaining_total_price
FROM pos.transaction_items ti JOIN pos.transactions t ON t.id=ti.transaction_id
JOIN internal.merchants m ON m.id=t.merchant_id LEFT JOIN internal.outlets o ON o.id=t.outlet_id
LEFT JOIN LATERAL(SELECT SUM(quantity) AS quantity,SUM(amount) AS amount FROM pos.transaction_refund_items WHERE transaction_item_id=ti.id) ret ON true;
REVOKE ALL ON contract.merchant_revenue,contract.merchant_directory,contract.admin_product_sales,
  contract.admin_sector_summary,contract.refund_totals,contract.transaction_items_detailed FROM PUBLIC,anon,authenticated;
DO $$ DECLARE reader text; BEGIN
  FOREACH reader IN ARRAY ARRAY['svc_pos','svc_ai','svc_internal','svc_backoffice','bi_readonly'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=reader) THEN
      EXECUTE format('GRANT SELECT ON contract.refund_totals TO %I',reader);
    END IF;
  END LOOP;
END $$;
