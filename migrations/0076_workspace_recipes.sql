-- Canonical workspace recipes reuse recipes/recipe_items and the immutable stock ledger.
-- No legacy recipe is rekeyed or stock balance invented.
ALTER TABLE pos.recipes ADD COLUMN IF NOT EXISTS module_id text REFERENCES internal.module_definitions(id);
ALTER TABLE pos.recipes ADD COLUMN IF NOT EXISTS workspace_revision bigint NOT NULL DEFAULT 1 CHECK(workspace_revision>0);
CREATE TABLE IF NOT EXISTS pos.workspace_recipe_consumption(
 id uuid PRIMARY KEY DEFAULT uuidv7(),
 tenant_id uuid NOT NULL REFERENCES internal.tenants(id),merchant_id uuid NOT NULL REFERENCES internal.merchants(id),
 outlet_id uuid NOT NULL REFERENCES internal.outlets(id),module_id text NOT NULL REFERENCES internal.module_definitions(id),
 transaction_item_id uuid NOT NULL REFERENCES pos.transaction_items(id),recipe_id uuid NOT NULL REFERENCES pos.recipes(id),
 recipe_revision bigint NOT NULL,inventory_item_id uuid NOT NULL REFERENCES pos.inventory_items(id),
 unit_cost numeric(12,4) NOT NULL CHECK(unit_cost>=0),
 location_id uuid NOT NULL REFERENCES pos.inventory_locations(id),quantity numeric(12,3) NOT NULL CHECK(quantity>0),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(transaction_item_id,inventory_item_id)
);
ALTER TABLE pos.inventory_transactions ADD COLUMN IF NOT EXISTS recipe_consumption_id uuid REFERENCES pos.workspace_recipe_consumption(id);
CREATE OR REPLACE FUNCTION pos.validate_workspace_recipe() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.module_id IS NOT NULL THEN
  IF NEW.output_inventory_item_id IS NOT NULL OR NEW.yield_quantity<=0 OR NOT EXISTS(SELECT 1 FROM pos.products p WHERE p.id=NEW.output_product_id AND p.tenant_id=NEW.tenant_id AND p.merchant_id=NEW.merchant_id AND p.module_id=NEW.module_id AND p.inventory_item_id IS NULL) THEN RAISE EXCEPTION 'RECIPE_WORKSPACE_MISMATCH' USING ERRCODE='23514';END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.module_id IS DISTINCT FROM NEW.module_id THEN RAISE EXCEPTION 'MODULE_ATTRIBUTION_IMMUTABLE' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_recipe_guard ON pos.recipes;
CREATE TRIGGER workspace_recipe_guard BEFORE INSERT OR UPDATE ON pos.recipes FOR EACH ROW EXECUTE FUNCTION pos.validate_workspace_recipe();
CREATE OR REPLACE FUNCTION pos.validate_workspace_recipe_item() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM pos.recipes WHERE id=NEW.recipe_id;
 IF r.module_id IS NOT NULL AND (NEW.quantity<=0 OR NEW.wastage_percentage<0 OR NEW.wastage_percentage>100 OR NOT EXISTS(SELECT 1 FROM pos.inventory_items i WHERE i.id=NEW.inventory_item_id AND i.tenant_id=r.tenant_id AND i.merchant_id=r.merchant_id AND i.module_id=r.module_id AND i.is_stockable AND i.base_unit=NEW.unit)) THEN RAISE EXCEPTION 'RECIPE_INGREDIENT_SCOPE_OR_UNIT_MISMATCH' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_recipe_item_guard ON pos.recipe_items;
CREATE TRIGGER workspace_recipe_item_guard BEFORE INSERT OR UPDATE ON pos.recipe_items FOR EACH ROW EXECUTE FUNCTION pos.validate_workspace_recipe_item();
CREATE OR REPLACE FUNCTION pos.validate_workspace_consumption() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pos.transaction_items li JOIN pos.transactions t ON t.id=li.transaction_id JOIN pos.recipes r ON r.id=NEW.recipe_id JOIN pos.inventory_items i ON i.id=NEW.inventory_item_id JOIN pos.inventory_locations l ON l.id=NEW.location_id WHERE li.id=NEW.transaction_item_id AND t.tenant_id=NEW.tenant_id AND t.merchant_id=NEW.merchant_id AND t.outlet_id=NEW.outlet_id AND t.module_id=NEW.module_id AND r.output_product_id=li.product_id AND r.tenant_id=NEW.tenant_id AND r.merchant_id=NEW.merchant_id AND r.module_id=NEW.module_id AND i.tenant_id=NEW.tenant_id AND i.merchant_id=NEW.merchant_id AND i.module_id=NEW.module_id AND l.tenant_id=NEW.tenant_id AND l.merchant_id=NEW.merchant_id AND l.outlet_id=NEW.outlet_id) THEN RAISE EXCEPTION 'RECIPE_CONSUMPTION_SCOPE_MISMATCH' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_consumption_guard ON pos.workspace_recipe_consumption;
CREATE TRIGGER workspace_consumption_guard BEFORE INSERT ON pos.workspace_recipe_consumption FOR EACH ROW EXECUTE FUNCTION pos.validate_workspace_consumption();
CREATE OR REPLACE FUNCTION pos.immutable_recipe_consumption() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'RECIPE_CONSUMPTION_IMMUTABLE' USING ERRCODE='23514';END $$;
DROP TRIGGER IF EXISTS immutable_recipe_consumption ON pos.workspace_recipe_consumption;
CREATE TRIGGER immutable_recipe_consumption BEFORE UPDATE OR DELETE ON pos.workspace_recipe_consumption FOR EACH ROW EXECUTE FUNCTION pos.immutable_recipe_consumption();
ALTER TABLE pos.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos.recipe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos.workspace_recipe_consumption ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_recipes ON pos.recipes;
CREATE POLICY workspace_recipes ON pos.recipes TO svc_pos USING(module_id IS NULL OR tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true) AND module_id=current_setting('app.module_id',true)) WITH CHECK(module_id IS NULL OR tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true) AND module_id=current_setting('app.module_id',true));
DROP POLICY IF EXISTS workspace_recipe_items ON pos.recipe_items;
CREATE POLICY workspace_recipe_items ON pos.recipe_items TO svc_pos USING(EXISTS(SELECT 1 FROM pos.recipes r WHERE r.id=recipe_id)) WITH CHECK(EXISTS(SELECT 1 FROM pos.recipes r WHERE r.id=recipe_id));
DROP POLICY IF EXISTS workspace_consumption ON pos.workspace_recipe_consumption;
CREATE POLICY workspace_consumption ON pos.workspace_recipe_consumption TO svc_pos USING(tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true) AND outlet_id::text=current_setting('app.outlet_id',true) AND module_id=current_setting('app.module_id',true)) WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true) AND merchant_id::text=current_setting('app.merchant_id',true) AND outlet_id::text=current_setting('app.outlet_id',true) AND module_id=current_setting('app.module_id',true));
REVOKE ALL ON pos.workspace_recipe_consumption FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON pos.workspace_recipe_consumption TO svc_pos;
REVOKE ALL ON FUNCTION pos.validate_workspace_recipe(),pos.validate_workspace_recipe_item(),pos.validate_workspace_consumption(),pos.immutable_recipe_consumption() FROM PUBLIC,anon,authenticated;
-- A movement tagged with a recipe snapshot cannot shed its original scope,
-- switch locations, invent a refund, or restore more than was consumed.
CREATE OR REPLACE FUNCTION pos.validate_recipe_movement() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE s record; remaining numeric;
BEGIN
 IF NEW.recipe_consumption_id IS NULL THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.recipe_consumption_id::text,0));
 SELECT rc.*,li.transaction_id INTO s FROM pos.workspace_recipe_consumption rc JOIN pos.transaction_items li ON li.id=rc.transaction_item_id WHERE rc.id=NEW.recipe_consumption_id;
 IF NOT FOUND OR (NEW.tenant_id,NEW.merchant_id,NEW.outlet_id,NEW.module_id,NEW.location_id,NEW.inventory_item_id) IS DISTINCT FROM(s.tenant_id,s.merchant_id,s.outlet_id,s.module_id,s.location_id,s.inventory_item_id) THEN RAISE EXCEPTION 'RECIPE_MOVEMENT_SCOPE_MISMATCH' USING ERRCODE='23514';END IF;
 SELECT -COALESCE(sum(quantity_delta),0) INTO remaining FROM pos.inventory_transactions WHERE recipe_consumption_id=s.id;
 IF NEW.reference_type='SALE_RECIPE_DEDUCT' THEN
  IF remaining<>0 OR NEW.quantity_delta<>-s.quantity OR NEW.reference_id<>s.transaction_id::text OR EXISTS(SELECT 1 FROM pos.inventory_transactions WHERE recipe_consumption_id=s.id) THEN RAISE EXCEPTION 'RECIPE_DEDUCTION_MISMATCH' USING ERRCODE='23514';END IF;
 ELSIF NEW.reference_type IN('REFUND_RECIPE_RESTORE','VOID_RECIPE_RESTORE') THEN
  IF NEW.quantity_delta<=0 OR NEW.quantity_delta>remaining OR (NEW.reference_type='VOID_RECIPE_RESTORE' AND (NEW.reference_id<>s.transaction_id::text OR NOT EXISTS(SELECT 1 FROM pos.transactions WHERE id=s.transaction_id AND order_status='VOIDED'))) OR (NEW.reference_type='REFUND_RECIPE_RESTORE' AND NOT EXISTS(SELECT 1 FROM pos.transaction_refunds r JOIN pos.transaction_refund_items ri ON ri.refund_id=r.id WHERE r.id::text=NEW.reference_id AND r.transaction_id=s.transaction_id AND ri.transaction_item_id=s.transaction_item_id)) THEN RAISE EXCEPTION 'RECIPE_RESTORATION_MISMATCH' USING ERRCODE='23514';END IF;
 ELSE RAISE EXCEPTION 'RECIPE_MOVEMENT_TYPE_INVALID' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS recipe_movement_guard ON pos.inventory_transactions;
CREATE TRIGGER recipe_movement_guard BEFORE INSERT ON pos.inventory_transactions FOR EACH ROW EXECUTE FUNCTION pos.validate_recipe_movement();
REVOKE ALL ON FUNCTION pos.validate_recipe_movement() FROM PUBLIC,anon,authenticated;
