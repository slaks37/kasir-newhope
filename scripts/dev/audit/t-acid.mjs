/**
 * ACID: satu transaksi yang GAGAL di tengah jalan tidak boleh meninggalkan apa
 * pun — bukan barisnya, bukan itemnya, dan bukan mutasi stoknya.
 *
 * Yang diuji bukan "apakah PostgreSQL bisa ROLLBACK" (tentu bisa), melainkan
 * apakah JALUR TULIS di sini benar-benar berada dalam satu transaksi. Checkout
 * menulis ke empat tabel; kalau salah satunya ditulis di luar BEGIN/COMMIT —
 * atau di koneksi lain — stok berkurang untuk penjualan yang tidak pernah
 * terjadi, dan tidak ada yang tahu sampai stock opname berikutnya.
 *
 * DUA CACAT PADA VERSI SEBELUMNYA, keduanya membuat uji ini bohong:
 *
 * 1. Ia memakai data sisa milik t-concurrency (`external_ref='own-conc'`,
 *    `sku='LAST-1'`). Begitu uji itu memakai awalan per-jalan, fixture-nya
 *    hilang dan uji ini mati dengan "Cannot destructure property 'tenant_id'".
 *    Uji yang menumpang fixture uji lain akan rusak oleh perubahan yang tidak
 *    ada hubungannya dengan apa yang diuji.
 *
 * 2. Kriteria lulusnya `trx === 0 && item === 0` — hitungan SELURUH database.
 *    Itu hanya benar pada database kosong. Setelah `npm run db:reseed`, ada
 *    3.704 transaksi contoh, dan uji ini akan melaporkan "ADA SISA" meskipun
 *    rollback-nya sempurna. Yang benar adalah SELISIH sebelum/sesudah pada
 *    fixture-nya sendiri, bukan nol global.
 */
import { conn, line } from './probe.mjs';

const c = await conn();
const RUN = Date.now().toString(36);
const own = `own-acid-${RUN}`;

// --- fixture milik sendiri -----------------------------------------------
const t = await c.query(
  `INSERT INTO internal.tenants (id,name,business_sector,external_ref,owner_user_ref)
   VALUES (uuidv7(),'Uji ACID','RETAIL',$1,$1) RETURNING id`, [own]);
const tenant_id = t.rows[0].id;

const m = await c.query(
  `INSERT INTO internal.merchants (id,tenant_id,name,business_sector,external_ref)
   VALUES (uuidv7(),$1,'Uji ACID','RETAIL',$2) RETURNING id`, [tenant_id, `${own}_RETAIL`]);
const merchant_id = m.rows[0].id;

const o = await c.query(
  `INSERT INTO internal.outlets (id,tenant_id,merchant_id,name)
   VALUES (uuidv7(),$1,$2,'Cabang') RETURNING id`, [tenant_id, merchant_id]);
const outlet_id = o.rows[0].id;

const loc = (await c.query(
  `INSERT INTO pos.inventory_locations (id,tenant_id,merchant_id,outlet_id,name,is_primary)
   VALUES (uuidv7(),$1,$2,$3,'Rak Utama',TRUE) RETURNING id`,
  [tenant_id, merchant_id, outlet_id])).rows[0].id;

const item = (await c.query(
  `INSERT INTO pos.inventory_items (id,tenant_id,merchant_id,item_name,sku,base_unit,item_type,cost_per_unit,is_stockable)
   VALUES (uuidv7(),$1,$2,'Barang Uji',$3,'pcs','PRODUCT',5000,TRUE) RETURNING id`,
  [tenant_id, merchant_id, `ACID-${RUN}`])).rows[0].id;

// Stok awal 10 — cukup banyak supaya penolakan datang dari langkah pembayaran,
// bukan dari penjaga stok. Yang diuji di sini rollback, bukan overselling.
await c.query(
  `INSERT INTO pos.inventory_transactions
   (id,tenant_id,merchant_id,outlet_id,location_id,inventory_item_id,quantity_delta,reference_type,reason)
   VALUES (uuidv7(),$1,$2,$3,$4,$5,10,'PURCHASE_IN','stok awal')`,
  [tenant_id, merchant_id, outlet_id, loc, item]);

/** Semuanya DIBATASI ke tenant uji ini. Hitungan global tidak berarti apa-apa. */
const hitung = async () => (await c.query(`SELECT
    (SELECT count(*)::int FROM pos.transactions            WHERE tenant_id=$1) AS trx,
    (SELECT count(*)::int FROM pos.transaction_items       WHERE tenant_id=$1) AS item,
    (SELECT count(*)::int FROM pos.inventory_transactions  WHERE tenant_id=$1) AS mutasi,
    (SELECT COALESCE(sum(current_stock),0)::float FROM pos.inventory_balances WHERE tenant_id=$1) AS stok`,
  [tenant_id])).rows[0];

const sebelum = await hitung();
line('\n  sebelum : ' + JSON.stringify(sebelum));

// --- transaksi yang GAGAL di tengah jalan --------------------------------
const k = await conn();
let pesan = '';
try {
  await k.query('BEGIN');
  const tx = await k.query(`INSERT INTO pos.transactions
    (id,tenant_id,merchant_id,outlet_id,subtotal,total_amount,payment_method,order_status,business_sector,business_id,client_txn_id)
    VALUES (uuidv7(),$1,$2,$3,50000,50000,'CASH','COMPLETED','RETAIL',$4,$5) RETURNING id`,
    [tenant_id, merchant_id, outlet_id, `${own}_RETAIL`, `ACID-${RUN}`]);
  const txId = tx.rows[0].id;

  await k.query(`INSERT INTO pos.transaction_items
    (id,transaction_id,tenant_id,product_name,unit_price,quantity,total_price,business_sector)
    VALUES (uuidv7(),$1,$2,'Barang Uji',50000,1,50000,'RETAIL')`, [txId, tenant_id]);

  await k.query(`INSERT INTO pos.inventory_transactions
    (id,tenant_id,merchant_id,outlet_id,location_id,inventory_item_id,quantity_delta,reference_type,reason)
    VALUES (uuidv7(),$1,$2,$3,$4,$5,-1,'SALE_DEDUCT','uji acid')`,
    [tenant_id, merchant_id, outlet_id, loc, item]);

  // KEGAGALAN di langkah terakhir — meniru pembayaran yang ditolak.
  await k.query(`INSERT INTO pos.payments
    (id,tenant_id,merchant_id,outlet_id,transaction_id,payment_method,payment_status,amount)
    VALUES (uuidv7(),$1,$2,$3,$4,'CASH','STATUS_NGAWUR',50000)`,
    [tenant_id, merchant_id, outlet_id, txId]);

  await k.query('COMMIT');
  pesan = 'COMMIT — tidak ada kegagalan (uji tidak valid)';
} catch (e) {
  await k.query('ROLLBACK').catch(() => {});
  pesan = `gagal di langkah pembayaran: [${e.code}] ${e.constraint || e.message.slice(0, 50)} -> ROLLBACK`;
} finally { await k.end().catch(() => {}); }

line('  ' + pesan);
const sesudah = await hitung();
line('  sesudah : ' + JSON.stringify(sesudah));

let gagal = 0;

// Uji ini tidak berarti apa-apa kalau langkah terakhirnya ternyata BERHASIL.
if (pesan.startsWith('COMMIT')) {
  gagal++;
  line('\n  >>> UJI TIDAK VALID: langkah pembayaran seharusnya ditolak, tapi lolos.');
} else {
  const beda = Object.keys(sebelum).filter((kunci) => Number(sesudah[kunci]) !== Number(sebelum[kunci]));
  if (beda.length) {
    gagal++;
    line(`\n  >>> ADA SISA: ${beda.map((b) => `${b} ${sebelum[b]} -> ${sesudah[b]}`).join(', ')}`);
  } else {
    line('\n  >>> ROLLBACK UTUH: transaksi, item, dan mutasi stok semuanya dibatalkan.');
  }
}

// --- kebalikannya: transaksi yang BERHASIL harus meninggalkan jejak lengkap ---
//
// Rollback yang sempurna gampang dipalsukan oleh jalur tulis yang memang tidak
// menulis apa-apa. Tanpa bagian ini, sebuah checkout yang diam-diam rusak akan
// LULUS uji di atas.
const kk = await conn();
try {
  await kk.query('BEGIN');
  const tx = await kk.query(`INSERT INTO pos.transactions
    (id,tenant_id,merchant_id,outlet_id,subtotal,total_amount,payment_method,order_status,business_sector,business_id,client_txn_id)
    VALUES (uuidv7(),$1,$2,$3,50000,50000,'CASH','COMPLETED','RETAIL',$4,$5) RETURNING id`,
    [tenant_id, merchant_id, outlet_id, `${own}_RETAIL`, `ACID-OK-${RUN}`]);
  const txId = tx.rows[0].id;
  await kk.query(`INSERT INTO pos.transaction_items
    (id,transaction_id,tenant_id,product_name,unit_price,quantity,total_price,business_sector)
    VALUES (uuidv7(),$1,$2,'Barang Uji',50000,1,50000,'RETAIL')`, [txId, tenant_id]);
  await kk.query(`INSERT INTO pos.inventory_transactions
    (id,tenant_id,merchant_id,outlet_id,location_id,inventory_item_id,quantity_delta,reference_type,reason)
    VALUES (uuidv7(),$1,$2,$3,$4,$5,-1,'SALE_DEDUCT','uji acid berhasil')`,
    [tenant_id, merchant_id, outlet_id, loc, item]);
  await kk.query(`INSERT INTO pos.payments
    (id,tenant_id,merchant_id,outlet_id,transaction_id,payment_method,payment_status,amount)
    VALUES (uuidv7(),$1,$2,$3,$4,'CASH','SETTLED',50000)`,
    [tenant_id, merchant_id, outlet_id, txId]);
  await kk.query('COMMIT');
} catch (e) {
  await kk.query('ROLLBACK').catch(() => {});
  gagal++;
  line(`  >>> checkout yang sah justru DITOLAK: ${e.message.split('\n')[0]}`);
} finally { await kk.end().catch(() => {}); }

const akhir = await hitung();
line('\n  setelah checkout yang SAH: ' + JSON.stringify(akhir));
if (akhir.trx === sebelum.trx + 1 && akhir.item === sebelum.item + 1
    && akhir.mutasi === sebelum.mutasi + 1 && Number(akhir.stok) === Number(sebelum.stok) - 1) {
  line('  >>> BENAR: yang berhasil tercatat lengkap, yang gagal tidak berbekas.\n');
} else {
  gagal++;
  line('  >>> SALAH: checkout yang berhasil tidak tercatat lengkap.\n');
}

await c.end();
process.exit(gagal === 0 ? 0 : 1);
