import { conn, line } from './probe.mjs';
const c = await conn();
const RUN = Date.now().toString(36);

/**
 * Menyiapkan satu merchant dengan stok 1 unit.
 *
 * `kebijakan` null berarti merchant TIDAK menyetel apa pun — persis seperti
 * merchant yang baru mendaftar. Kasus itulah yang paling penting diuji: yang
 * bocor bukan penyetelan eksplisit, melainkan bawaannya.
 */
async function siapkan(kebijakan, sektor, tag = kebijakan ?? 'bawaan') {
  const own = `own-conc-${tag}-${RUN}`;
  const t = await c.query(`INSERT INTO internal.tenants (id,name,external_ref,owner_user_ref)
    VALUES (uuidv7(),'Uji Konkurensi',$1,$1)
    ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
    DO UPDATE SET name=EXCLUDED.name RETURNING id`,[own]);
  const tenantId=t.rows[0].id;
  const m = await c.query(`INSERT INTO internal.merchants (id,tenant_id,name,business_sector,external_ref,stock_policy)
    VALUES (uuidv7(),$1,'Uji',$2,$3,$4)
    ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
    DO UPDATE SET stock_policy=EXCLUDED.stock_policy RETURNING id`,[tenantId,sektor,`${own}_${sektor}`,kebijakan]);
  const merchantId=m.rows[0].id;
  let o = await c.query(`SELECT id FROM internal.outlets WHERE merchant_id=$1 LIMIT 1`,[merchantId]);
  if(!o.rows.length) o = await c.query(`INSERT INTO internal.outlets (id,tenant_id,merchant_id,name)
    VALUES (uuidv7(),$1,$2,'Cabang') RETURNING id`,[tenantId,merchantId]);
  const outletId=o.rows[0].id;
  const loc = await c.query(`INSERT INTO pos.inventory_locations (id,tenant_id,merchant_id,outlet_id,name,is_primary)
    VALUES (uuidv7(),$1,$2,$3,'Rak Utama',TRUE) RETURNING id`,[tenantId,merchantId,outletId]);
  const it = await c.query(`INSERT INTO pos.inventory_items (id,tenant_id,merchant_id,item_name,sku,base_unit,item_type,cost_per_unit,is_stockable)
    VALUES (uuidv7(),$1,$2,'Barang Terakhir',$3,'pcs','PRODUCT',5000,TRUE) RETURNING id`,[tenantId,merchantId,`LAST-${tag}-${RUN}`]);
  const ids={tenantId,merchantId,outletId,locId:loc.rows[0].id,itemId:it.rows[0].id};
  await c.query(`INSERT INTO pos.inventory_transactions
    (id,tenant_id,merchant_id,outlet_id,location_id,inventory_item_id,quantity_delta,reference_type,reason)
    VALUES (uuidv7(),$1,$2,$3,$4,$5,1,'PURCHASE_IN','stok awal')`,
    [ids.tenantId,ids.merchantId,ids.outletId,ids.locId,ids.itemId]);
  return ids;
}

const stok = async (ids) => (await c.query(
  `SELECT current_stock FROM pos.inventory_balances WHERE inventory_item_id=$1 AND outlet_id=$2`,
  [ids.itemId,ids.outletId])).rows[0]?.current_stock;

/** Dua kasir menjual unit terakhir BERSAMAAN, koneksi terpisah. */
async function duaKasir(ids) {
  const jual = async (nama) => {
    const k = await conn();
    try {
      await k.query('BEGIN');
      await k.query(`INSERT INTO pos.inventory_transactions
        (id,tenant_id,merchant_id,outlet_id,location_id,inventory_item_id,quantity_delta,reference_type,reason)
        VALUES (uuidv7(),$1,$2,$3,$4,$5,-1,'SALE_DEDUCT',$6)`,
        [ids.tenantId,ids.merchantId,ids.outletId,ids.locId,ids.itemId,nama]);
      await k.query('COMMIT');
      return { nama, ok: true };
    } catch(e) {
      await k.query('ROLLBACK').catch(()=>{});
      return { nama, ok: false, pesan: (e.message||'').split('\n')[0].slice(0,70) };
    } finally { await k.end().catch(()=>{}); }
  };
  return Promise.all([jual('kasir-A'), jual('kasir-B')]);
}

let gagal = 0;

line('\n  A. RETAIL (kebijakan BLOCK) — stok fisik mutlak');
const retail = await siapkan('BLOCK','RETAIL');
line(`     stok awal: ${await stok(retail)}`);
let hasil = await duaKasir(retail);
hasil.forEach(h => line(`     ${h.nama}: ${h.ok?'BERHASIL menjual':'DITOLAK — '+h.pesan}`));
const sisaRetail = Number(await stok(retail));
const berhasilRetail = hasil.filter(h=>h.ok).length;
line(`     stok akhir: ${sisaRetail}`);
if (sisaRetail < 0 || berhasilRetail !== 1) { gagal++; line('     >>> SALAH: harus tepat satu berhasil dan stok >= 0'); }
else line('     >>> BENAR: satu berhasil, satu ditolak, stok 0');

line('\n  B. FNB (kebijakan WARN) — stok turunan resep, penjualan tidak boleh gagal');
const fnb = await siapkan('WARN','FNB');
line(`     stok awal: ${await stok(fnb)}`);
hasil = await duaKasir(fnb);
hasil.forEach(h => line(`     ${h.nama}: ${h.ok?'BERHASIL menjual':'DITOLAK — '+h.pesan}`));
const sisaFnb = Number(await stok(fnb));
line(`     stok akhir: ${sisaFnb}`);
const sel = await c.query(`SELECT stok_sebelum, delta, stok_sesudah, belum_direkonsiliasi
  FROM contract.stock_discrepancies WHERE merchant_id=$1`,[fnb.merchantId]);
line(`     selisih tercatat: ${sel.rows.length} baris`);
sel.rows.forEach(r=>line(`       ${r.stok_sebelum} ${r.delta} -> ${r.stok_sesudah}  belum beres=${r.belum_direkonsiliasi}`));
if (hasil.filter(h=>h.ok).length !== 2) { gagal++; line('     >>> SALAH: penjualan jasa/resep tidak boleh ditolak'); }
else if (sel.rows.length === 0) { gagal++; line('     >>> SALAH: stok negatif TIDAK tercatat — itu sama dengan didiamkan'); }
else line('     >>> BENAR: keduanya terjual, selisihnya tercatat untuk rekonsiliasi');

/*
 * Bagian C ada karena A dan B TIDAK cukup.
 *
 * Keduanya menyetel stock_policy secara eksplisit, jadi keduanya lulus bahkan
 * ketika bawaannya rusak. Versi pertama migrasi 0044 memakai backfill sekali
 * jalan (`UPDATE ... WHERE business_sector='RETAIL'`), yang hanya menyentuh
 * baris yang ada SAAT migrasi berjalan. Setiap toko retail yang mendaftar
 * sesudahnya mendapat 'WARN' dan boleh menjual barang yang stoknya nol.
 *
 * Ketahuannya bukan dari uji ini, melainkan dari `npm run db:reseed`: merchant
 * RETAIL hasil seed muncul dengan kebijakan 'WARN'. Bagian ini memastikan
 * jalan itu tidak perlu ditempuh dua kali.
 */
line('\n  C. Merchant BARU tanpa penyetelan — bawaan menurut sektor');

const retailBaru = await siapkan(null, 'RETAIL', 'retail-bawaan');
const efektif = await c.query(
  `SELECT stock_policy, internal.fn_stock_policy(business_sector::text, stock_policy) AS berlaku
     FROM internal.merchants WHERE id=$1`, [retailBaru.merchantId]);
line(`     kolom=${efektif.rows[0].stock_policy ?? 'NULL (ikut sektor)'}  berlaku=${efektif.rows[0].berlaku}`);
hasil = await duaKasir(retailBaru);
hasil.forEach(h => line(`     ${h.nama}: ${h.ok?'BERHASIL menjual':'DITOLAK — '+h.pesan}`));
const sisaBaru = Number(await stok(retailBaru));
line(`     stok akhir: ${sisaBaru}`);
if (sisaBaru < 0 || hasil.filter(h=>h.ok).length !== 1) {
  gagal++; line('     >>> SALAH: RETAIL tanpa penyetelan harus tetap MENOLAK penjualan berlebih');
} else line('     >>> BENAR: bawaan sektor berlaku tanpa perlu backfill');

line('\n  D. Kebijakan yang berlaku per merchant');
const bawaan = await c.query(`SELECT business_sector,
    COALESCE(stock_policy,'(bawaan)') AS disetel,
    internal.fn_stock_policy(business_sector::text, stock_policy) AS berlaku,
    count(*)::int n
  FROM internal.merchants GROUP BY 1,2,3 ORDER BY 1,3`);
bawaan.rows.forEach(r=>line(
  `     ${String(r.business_sector).padEnd(12)} disetel=${String(r.disetel).padEnd(9)} berlaku=${String(r.berlaku).padEnd(6)} ${r.n} merchant`));

line(gagal===0 ? '\n  >>> LULUS: overselling ditutup untuk RETAIL, tercatat untuk sektor lain.\n'
               : `\n  >>> ${gagal} MASALAH.\n`);
await c.end();
process.exit(gagal===0?0:1);
