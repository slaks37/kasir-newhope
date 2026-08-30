/**
 * KONFLIK KATALOG ANTAR PERANGKAT.
 *
 * Skenario yang diuji adalah skenario yang PALING SERING terjadi pada merchant
 * multi-outlet, dan yang paling tidak terlihat saat terjadi:
 *
 *   1. tablet-A dan tablet-B sama-sama menyimak katalog yang sama
 *   2. tablet-B offline (baterai habis, dibawa pulang, wifi mati)
 *   3. dari tablet-A pemilik menambah produk baru dan menaikkan harga
 *   4. besoknya tablet-B menyala dan mengirim katalog KEMARIN
 *
 * Tanpa penjaga revisi, langkah 4 memensiunkan seluruh produk dari langkah 3
 * dan mengembalikan harga yang sudah dinaikkan — di SEMUA perangkat sekaligus,
 * tanpa satu pun pesan.
 *
 * Uji ini membuktikan tiga hal, dan ketiganya perlu:
 *   A. perangkat basi tidak memensiunkan produk yang belum pernah ia lihat
 *   B. perangkat basi tidak menimpa harga yang lebih baru
 *   C. penghapusan yang SUNGGUHAN tetap bekerja — kalau penjaga menolak semua
 *      pensiun, ia bukan penjaga melainkan kerusakan lain
 */
import { conn, line } from './probe.mjs';

const API = 'http://127.0.0.1:3101';
const RUN = Date.now().toString(36);
const OWNER = `own-kat-${RUN}`;
const BIZ = `${OWNER}_RETAIL`;

for (let i = 0; i < 30; i++) {
  if (await fetch(API + '/ready').then((r) => r.ok).catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 1000));
}

const kirim = (baseRevision, products) =>
  fetch(API + '/api/v1/sync/catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-sub': OWNER },
    body: JSON.stringify({
      businessId: BIZ, sector: 'RETAIL', storeName: 'Toko Uji Katalog',
      ownerRef: OWNER, baseRevision, products,
    }),
  }).then(async (r) => ({ s: r.status, b: await r.json().catch(() => ({})) }));

const c = await conn();
const katalog = async () => (await c.query(
  `SELECT p.external_ref, p.name, p.price::float, p.is_available, p.revision::int
     FROM pos.products p JOIN internal.tenants t ON t.id = p.tenant_id
    WHERE t.external_ref = $1 ORDER BY p.external_ref`, [OWNER])).rows;

const produk = (id, nama, harga) => ({ id, name: nama, price: harga, costPrice: harga / 2, isAvailable: true });

let gagal = 0;
const cek = (ok, pesan) => { if (ok) line(`     OK     ${pesan}`); else { gagal++; line(`     GAGAL  ${pesan}`); } };

// --- 1. Kedua perangkat menyimak katalog yang sama -------------------------
line('\n  1. Dua perangkat menyimak katalog yang sama');
const awal = [produk('p-kopi', 'Kopi Susu', 18000), produk('p-teh', 'Teh Manis', 8000)];
let r = await kirim(0, awal);
const revBersama = r.b.revision;
line(`     tablet-A & tablet-B sama-sama pada revisi ${revBersama} (${r.b.upserted} produk)`);
cek(r.s === 200 && revBersama > 0, 'katalog awal terkirim, revisi diberikan server');

// --- 2. tablet-B offline. tablet-A bekerja. --------------------------------
line('\n  2. tablet-B offline; dari tablet-A pemilik menambah produk & menaikkan harga');
r = await kirim(revBersama, [
  produk('p-kopi', 'Kopi Susu', 22000),      // harga naik
  produk('p-teh', 'Teh Manis', 8000),
  produk('p-roti', 'Roti Bakar', 15000),     // produk baru
  produk('p-donat', 'Donat Gula', 12000),    // produk baru
]);
const revA = r.b.revision;
line(`     tablet-A kini pada revisi ${revA} (${r.b.upserted} produk)`);
cek(r.s === 200 && revA > revBersama, 'revisi maju setelah perubahan tablet-A');

// --- 3. tablet-B menyala dan mengirim katalog KEMARIN ----------------------
line('\n  3. tablet-B menyala, mengirim katalog KEMARIN (revisi lama, harga lama)');
r = await kirim(revBersama, awal);
line(`     server: upserted=${r.b.upserted} retired=${r.b.retired} konflik=${(r.b.konflik || []).length}`);

const sesudah = await katalog();
const cari = (ref) => sesudah.find((x) => x.external_ref === ref);

line('\n     keadaan katalog setelah tablet-B menyusul:');
sesudah.forEach((p) => line(
  `       ${p.external_ref.padEnd(9)} ${String(p.name).padEnd(12)} ${String(p.price).padEnd(7)} tersedia=${p.is_available} rev=${p.revision}`));

line('');
cek(cari('p-roti')?.is_available === true,  'A. produk baru "Roti Bakar" TIDAK dipensiunkan perangkat basi');
cek(cari('p-donat')?.is_available === true, 'A. produk baru "Donat Gula" TIDAK dipensiunkan perangkat basi');
cek(cari('p-kopi')?.price === 22000,        'B. harga baru 22.000 TIDAK dikembalikan ke 18.000');
cek((r.b.konflik || []).includes('p-kopi'), 'B. penolakan dilaporkan balik ke perangkat, bukan didiamkan');

// --- 4. Penghapusan yang SUNGGUHAN harus tetap bekerja ---------------------
//
// Penjaga yang menolak setiap pensiun sama rusaknya dengan yang tidak menolak
// apa pun: produk yang benar-benar dihapus pemilik akan hidup selamanya.
line('\n  4. Penghapusan SUNGGUHAN dari perangkat yang sudah menyusul');
const revTerkini = (await c.query(
  `SELECT catalog_revision::int r FROM internal.tenants WHERE external_ref=$1`, [OWNER])).rows[0].r;
r = await kirim(revTerkini, [
  produk('p-kopi', 'Kopi Susu', 22000),
  produk('p-roti', 'Roti Bakar', 15000),
  produk('p-donat', 'Donat Gula', 12000),
]);  // p-teh sengaja dihilangkan
line(`     server: upserted=${r.b.upserted} retired=${r.b.retired}`);
const akhir = await katalog();
const teh = akhir.find((x) => x.external_ref === 'p-teh');
cek(teh?.is_available === false, 'C. "Teh Manis" yang benar-benar dihapus TETAP dipensiunkan');
cek(akhir.find((x) => x.external_ref === 'p-roti')?.is_available === true,
    'C. produk lain tidak ikut terpensiun');

// --- 5. Perangkat tanpa revisi sama sekali --------------------------------
line('\n  5. Perangkat tanpa revisi (pemasangan baru / metadata hilang)');
r = await kirim(0, [produk('p-kopi', 'Kopi Susu', 22000)]);
line(`     server: upserted=${r.b.upserted} retired=${r.b.retired}`);
cek(r.b.retired === 0, 'perangkat yang tidak tahu apa-apa TIDAK memensiunkan apa pun');
const stlh5 = await katalog();
cek(stlh5.find((x) => x.external_ref === 'p-roti')?.is_available === true,
    'produk perangkat lain selamat dari perangkat tanpa revisi');

line(gagal === 0
  ? '\n  >>> LULUS: perangkat basi tidak bisa menghapus pekerjaan perangkat lain.\n'
  : `\n  >>> ${gagal} MASALAH.\n`);
await c.end();
process.exit(gagal === 0 ? 0 : 1);
