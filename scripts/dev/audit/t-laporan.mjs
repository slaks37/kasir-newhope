/**
 * LAPORAN MERCHANT: apakah angkanya lengkap?
 *
 * CACAT YANG DIUJI.
 *
 * Aplikasi kasir memangkas order di localStorage ke 50 terbaru — benar untuk
 * penyimpanan, dan salah begitu layar Laporan hanya membaca state lokal.
 * Sesudah muat ulang halaman, filter "Bulan Ini" menjumlahkan paling banyak
 * 50 transaksi lalu menampilkannya sebagai omzet sebulan. Tanpa tanda apa pun.
 *
 * Merchant di data contoh punya lebih dari seribu transaksi per bulan. Selisih
 * antara "50 terakhir" dan omzet sesungguhnya bukan kesalahan pembulatan —
 * ia bisa lebih dari 90%.
 *
 * Uji ini membandingkan apa yang dilaporkan endpoint riwayat dengan jumlah
 * SEBENARNYA di database, lalu memperlihatkan berapa besar yang akan hilang
 * kalau layar itu tetap membaca 50 baris lokal saja.
 */
import { API_URL as API, conn, line } from './probe.mjs';


for (let i = 0; i < 30; i++) {
  if (await fetch(API + '/ready').then((r) => r.ok).catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 1000));
}

const c = await conn();
let gagal = 0;
const cek = (ok, pesan) => { if (ok) line(`     OK     ${pesan}`); else { gagal++; line(`     GAGAL  ${pesan}`); } };
const rupiah = (n) => 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID');

// Merchant paling ramai di data contoh.
const m = (await c.query(
  `SELECT t.external_ref AS business_id, t.owner_user_ref, t.name, count(x.id)::int n
     FROM internal.tenants t JOIN pos.transactions x ON x.tenant_id = t.id
    GROUP BY 1,2,3 ORDER BY n DESC LIMIT 1`)).rows[0];

if (!m) {
  line('\n  Tidak ada data transaksi. Jalankan `npm run db:reseed` lebih dulu.');
  await c.end();
  process.exit(0);
}
line(`\n  Merchant: ${m.name} (${m.n} transaksi tersinkron)`);

const ambil = (from, to) =>
  fetch(`${API}/api/v1/reports/orders?businessId=${encodeURIComponent(m.business_id)}` +
        `&from=${from.toISOString()}&to=${to.toISOString()}`,
        { headers: { 'x-auth-sub': m.owner_user_ref } })
    .then(async (r) => ({ s: r.status, b: await r.json().catch(() => ({})) }));

/*
 * Batas ATAS ikut dipakai di kedua sisi, dan itu bukan detail.
 *
 * Versi pertama uji ini membandingkan endpoint (yang membatasi `<= sekarang`)
 * dengan kueri kebenaran yang tidak membatasi atasnya sama sekali, lalu
 * melaporkan selisih 14 transaksi sebagai cacat endpoint. Yang sebenarnya
 * terjadi: seeder menaruh transaksi pada jam-jam acak sepanjang hari, termasuk
 * jam yang belum tiba. Membandingkan dua rentang yang berbeda selalu
 * menghasilkan selisih, dan selisih itu tidak berarti apa-apa.
 */
const sekarang = new Date();
const bulanLalu = new Date(sekarang.getTime() - 30 * 86400000);

// --- 1. Apa yang SEBENARNYA terjadi bulan ini -----------------------------
const nyata = (await c.query(
  `SELECT count(*)::int n, COALESCE(sum(x.total_amount),0)::float omzet
     FROM pos.transactions x JOIN internal.tenants t ON t.id = x.tenant_id
    WHERE t.external_ref = $1
      AND x.created_at >= $2::timestamptz
      AND x.created_at <= $3::timestamptz`,
  [m.business_id, bulanLalu.toISOString(), sekarang.toISOString()])).rows[0];

line(`\n  1. Kebenaran di database (30 hari terakhir)`);
line(`     ${nyata.n} transaksi, omzet ${rupiah(nyata.omzet)}`);

// --- 2. Apa yang dilaporkan endpoint --------------------------------------
line('\n  2. Yang dilaporkan endpoint riwayat');
const r = await ambil(bulanLalu, sekarang);
const omzetServer = (r.b.orders || []).reduce((a, o) => a + Number(o.total_amount), 0);
line(`     ${r.b.total} transaksi, omzet ${rupiah(omzetServer)}  (terpotong=${r.b.terpotong})`);
cek(r.s === 200, 'endpoint menjawab 200');
cek(r.b.total === nyata.n, `jumlah transaksi cocok (${r.b.total} vs ${nyata.n})`);
cek(Math.round(omzetServer) === Math.round(nyata.omzet), 'omzet cocok sampai rupiah terakhir');
cek((r.b.orders[0]?.items || []).length > 0, 'baris struk ikut terbawa');

// --- 3. Berapa besar yang HILANG tanpa endpoint ini ------------------------
line('\n  3. Kalau layar Laporan hanya membaca 50 order lokal');
const fifty = (await c.query(
  `SELECT COALESCE(sum(total_amount),0)::float omzet FROM (
     SELECT x.total_amount FROM pos.transactions x JOIN internal.tenants t ON t.id = x.tenant_id
      WHERE t.external_ref = $1
        AND x.created_at >= $2::timestamptz
        AND x.created_at <= $3::timestamptz
      ORDER BY x.created_at DESC LIMIT 50) s`,
  [m.business_id, bulanLalu.toISOString(), sekarang.toISOString()])).rows[0].omzet;
const hilang = nyata.omzet - fifty;
line(`     terlihat  ${rupiah(fifty)}`);
line(`     HILANG    ${rupiah(hilang)}  (${((hilang / nyata.omzet) * 100).toFixed(1)}% dari omzet)`);
cek(hilang > 0, 'cacatnya nyata dan terukur pada data contoh');

// --- 4. Penjaga rentang ----------------------------------------------------
line('\n  4. Penjaga rentang');
const terlaluLebar = await ambil(new Date(sekarang.getTime() - 500 * 86400000), sekarang);
cek(terlaluLebar.s === 413, `rentang di atas 400 hari ditolak (${terlaluLebar.s})`);
const terbalik = await ambil(sekarang, bulanLalu);
cek(terbalik.s === 400, `rentang terbalik ditolak (${terbalik.s})`);

// --- 5. Isolasi tenant -----------------------------------------------------
line('\n  5. Isolasi tenant');
const penyusup = await fetch(
  `${API}/api/v1/reports/orders?businessId=${encodeURIComponent(m.business_id)}` +
  `&from=${bulanLalu.toISOString()}&to=${sekarang.toISOString()}`,
  { headers: { 'x-auth-sub': 'penyusup-tidak-dikenal' } });
cek(penyusup.status === 403, `pemilik lain tidak bisa membaca riwayat ini (${penyusup.status})`);

line(gagal === 0
  ? '\n  >>> LULUS: laporan membaca omzet penuh dari server, bukan 50 baris terakhir.\n'
  : `\n  >>> ${gagal} MASALAH.\n`);
await c.end();
process.exit(gagal === 0 ? 0 : 1);
