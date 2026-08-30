import { conn, line } from './probe.mjs';

const c = await conn();

// --- siapkan satu merchant + satu item dengan stok TEPAT 1 ---
await c.query(`DELETE FROM pos.inventory_transactions`);
await c.query(`DELETE FROM pos.inventory_balances`);
const t = await c.query(`INSERT INTO internal.tenants (id,name,external_ref,owner_user_ref)
  VALUES (uuidv7(),'Uji Konkurensi','own-conc','own-conc')
  ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL DO UPDATE SET name=EXCLUDED.name RETURNING id`);
const tenantId=t.rows[0].id;
const m = await c.query(`INSERT INTO internal.merchants (id,tenant_id,name,business_sector,external_ref)
  VALUES (uuidv7(),$1,'Uji','RETAIL','own-conc_RETAIL')
  ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL DO UPDATE SET name=EXCLUDED.name RETURNING id`,[tenantId]);
const merchantId=m.rows[0].id;
let o = await c.query(`SELECT id FROM internal.outlets WHERE merchant_id=$1 LIMIT 1`,[merchantId]);
if(!o.rows.length) o = await c.query(`INSERT INTO internal.outlets (id,tenant_id,merchant_id,name)
  VALUES (uuidv7(),$1,$2,'Cabang') RETURNING id`,[tenantId,merchantId]);
const outletId=o.rows[0].id;

let loc = await c.query(`SELECT id FROM pos.inventory_locations WHERE outlet_id=$1 LIMIT 1`,[outletId]);
if(!loc.rows.length) loc = await c.query(`INSERT INTO pos.inventory_locations (id,tenant_id,merchant_id,outlet_id,name,is_primary)
  VALUES (uuidv7(),$1,$2,$3,'Rak Utama',TRUE) RETURNING id`,[tenantId,merchantId,outletId]);
const locId=loc.rows[0].id;

let it = await c.query(`SELECT id FROM pos.inventory_items WHERE merchant_id=$1 AND sku='LAST-1' LIMIT 1`,[merchantId]);
if(!it.rows.length) it = await c.query(`INSERT INTO pos.inventory_items (id,tenant_id,merchant_id,item_name,sku,base_unit,item_type,cost_per_unit,is_stockable)
  VALUES (uuidv7(),$1,$2,'Barang Terakhir','LAST-1','pcs','PRODUCT',5000,TRUE) RETURNING id`,[tenantId,merchantId]);
const itemId=it.rows[0].id;

// stok masuk 1 unit
await c.query(`INSERT INTO pos.inventory_transactions
  (id,tenant_id,merchant_id,outlet_id,location_id,inventory_item_id,quantity_delta,reference_type,reason)
  VALUES (uuidv7(),$1,$2,$3,$4,$5,1,'PURCHASE_IN','stok awal')`,[tenantId,merchantId,outletId,locId,itemId]);

const stok = async () => (await c.query(
  `SELECT current_stock FROM pos.inventory_balances WHERE inventory_item_id=$1 AND outlet_id=$2`,
  [itemId,outletId])).rows[0]?.current_stock;

line(`\n  stok awal : ${await stok()}`);

// --- DUA KASIR, satu unit terakhir, bersamaan ---
const kasir = async (nama) => {
  const k = await conn();
  try {
    await k.query('BEGIN');
    await k.query(`INSERT INTO pos.inventory_transactions
      (id,tenant_id,merchant_id,outlet_id,location_id,inventory_item_id,quantity_delta,reference_type,reason)
      VALUES (uuidv7(),$1,$2,$3,$4,$5,-1,'SALE_DEDUCT',$6)`,
      [tenantId,merchantId,outletId,locId,itemId,nama]);
    await k.query('COMMIT');
    return `${nama}: BERHASIL menjual`;
  } catch(e) {
    await k.query('ROLLBACK').catch(()=>{});
    return `${nama}: DITOLAK [${e.code}] ${e.constraint||e.message.slice(0,60)}`;
  } finally { await k.end().catch(()=>{}); }
};

const hasil = await Promise.all([kasir('kasir-A'), kasir('kasir-B')]);
hasil.forEach(h=>line('  '+h));

const akhir = await stok();
line(`  stok akhir: ${akhir}`);
line(akhir < 0
  ? `\n  >>> OVERSELLING: stok jadi ${akhir}. Dua kasir sama-sama menjual unit yang sama.`
  : `\n  >>> stok tidak minus.`);

const ck = await c.query(`SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint
  WHERE conrelid='pos.inventory_balances'::regclass AND contype='c'`);
line(`  CHECK constraint di inventory_balances: ${ck.rows.length? ck.rows.map(r=>r.conname+' '+r.def).join(' | ') : 'TIDAK ADA'}`);
await c.end();
