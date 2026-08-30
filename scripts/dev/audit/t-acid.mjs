import { conn, line } from './probe.mjs';
const c = await conn();

const ids = await c.query(`SELECT t.id tenant_id, m.id merchant_id, o.id outlet_id
  FROM internal.tenants t JOIN internal.merchants m ON m.tenant_id=t.id
  JOIN internal.outlets o ON o.merchant_id=m.id WHERE t.external_ref='own-conc' LIMIT 1`);
const {tenant_id,merchant_id,outlet_id}=ids.rows[0];
const loc=(await c.query(`SELECT id FROM pos.inventory_locations WHERE outlet_id=$1 LIMIT 1`,[outlet_id])).rows[0].id;
const item=(await c.query(`SELECT id FROM pos.inventory_items WHERE sku='LAST-1' LIMIT 1`)).rows[0].id;

const hitung = async () => {
  const r = await c.query(`SELECT
    (SELECT count(*)::int FROM pos.transactions)              AS trx,
    (SELECT count(*)::int FROM pos.transaction_items)         AS item,
    (SELECT count(*)::int FROM pos.inventory_transactions)    AS mutasi,
    (SELECT COALESCE(sum(current_stock),0) FROM pos.inventory_balances) AS stok`);
  return r.rows[0];
};

line('\n  sebelum : ' + JSON.stringify(await hitung()));

// --- transaksi yang GAGAL di tengah jalan ---
const k = await conn();
let pesan='';
try {
  await k.query('BEGIN');
  const tx = await k.query(`INSERT INTO pos.transactions
    (id,tenant_id,merchant_id,outlet_id,subtotal,total_amount,payment_method,order_status,business_sector,business_id,client_txn_id)
    VALUES (uuidv7(),$1,$2,$3,50000,50000,'CASH','COMPLETED','RETAIL','own-conc_RETAIL','ACID-1') RETURNING id`,
    [tenant_id,merchant_id,outlet_id]);
  const txId = tx.rows[0].id;

  await k.query(`INSERT INTO pos.transaction_items
    (id,transaction_id,tenant_id,product_name,unit_price,quantity,total_price,business_sector)
    VALUES (uuidv7(),$1,$2,'Barang Terakhir',50000,1,50000,'RETAIL')`,[txId,tenant_id]);

  // mutasi stok
  await k.query(`INSERT INTO pos.inventory_transactions
    (id,tenant_id,merchant_id,outlet_id,location_id,inventory_item_id,quantity_delta,reference_type,reason)
    VALUES (uuidv7(),$1,$2,$3,$4,$5,-1,'SALE_DEDUCT','uji acid')`,
    [tenant_id,merchant_id,outlet_id,loc,item]);

  // KEGAGALAN di langkah terakhir — meniru pembayaran yang ditolak
  await k.query(`INSERT INTO pos.payments
    (id,tenant_id,merchant_id,outlet_id,transaction_id,payment_method,payment_status,amount)
    VALUES (uuidv7(),$1,$2,$3,$4,'CASH','STATUS_NGAWUR',50000)`,
    [tenant_id,merchant_id,outlet_id,txId]);

  await k.query('COMMIT');
  pesan = 'COMMIT — tidak ada kegagalan (uji tidak valid)';
} catch(e) {
  await k.query('ROLLBACK').catch(()=>{});
  pesan = `gagal di langkah pembayaran: [${e.code}] ${e.constraint || e.message.slice(0,50)} -> ROLLBACK`;
} finally { await k.end().catch(()=>{}); }

line('  ' + pesan);
const sesudah = await hitung();
line('  sesudah : ' + JSON.stringify(sesudah));

const bersih = sesudah.trx===0 && sesudah.item===0;
line(bersih
  ? '\n  >>> ROLLBACK UTUH: transaksi, item, dan mutasi stok semuanya dibatalkan.'
  : '\n  >>> ADA SISA: sebagian data tertinggal setelah rollback.');
await c.end();
