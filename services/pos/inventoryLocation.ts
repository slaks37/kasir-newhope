import type {Db} from '../shared/db';
import {BillingError} from '../billing/engine';
export async function ensureInventoryLocation(db: Db, tenantId: string, merchantId: string, outletId: string): Promise<string> {
  const existing=await db.query(`SELECT id FROM pos.inventory_locations
    WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND is_primary AND is_active
    ORDER BY created_at,id LIMIT 1`,[tenantId,merchantId,outletId]);
  if(existing.rows.length)return existing.rows[0].id;
  await db.query(`INSERT INTO pos.inventory_locations
    (id,tenant_id,merchant_id,outlet_id,name,is_primary,is_active)
    VALUES(uuidv7(),$1,$2,$3,'Gudang Utama',true,true)
    ON CONFLICT(outlet_id,name) DO NOTHING`,[tenantId,merchantId,outletId]);
  const created=await db.query(`SELECT id FROM pos.inventory_locations
    WHERE tenant_id=$1 AND merchant_id=$2 AND outlet_id=$3 AND is_active
    ORDER BY is_primary DESC,created_at,id LIMIT 1`,[tenantId,merchantId,outletId]);
  if(!created.rows.length)throw new BillingError(409,'INVENTORY_LOCATION_REQUIRED');
  return created.rows[0].id;
}

