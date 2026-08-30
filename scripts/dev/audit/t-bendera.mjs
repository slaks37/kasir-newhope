/**
 * BENDERA FITUR & PELUNCURAN BERTAHAP.
 *
 * Yang diuji bukan "apakah bendera bisa dinyalakan" — itu bagian yang mudah.
 * Yang diuji adalah sifat-sifat yang membuat canary sungguh berguna, dan yang
 * paling sering dilanggar oleh implementasi bendera fitur:
 *
 *   STABIL         merchant yang sama selalu mendapat jawaban yang sama.
 *                  Fitur yang berkedip antar permintaan lebih buruk daripada
 *                  fitur yang mati: kasir melihat tombol yang kadang ada,
 *                  dan tidak ada yang bisa mereproduksinya.
 *
 *   BERBEDA        setiap bendera memilih himpunan merchant yang berbeda.
 *   PER BENDERA    kalau tidak, merchant di ember 1-5 menjadi kelinci
 *                  percobaan untuk SETIAP canary selamanya. Itu bukan
 *                  peluncuran bertahap, itu memilih korban tetap.
 *
 *   URUTAN         daftar hitam mengalahkan segalanya, termasuk daftar putih
 *                  dan peluncuran 100%. "Jangan pernah nyalakan untuk merchant
 *                  ini" harus berarti persis itu.
 *
 *   GAGAL MATI     bendera yang tidak dikenal, dan kegagalan apa pun,
 *                  menghasilkan MATI. Bendera adalah cara menyalakan sesuatu
 *                  dengan sengaja; salah ketik namanya tidak boleh menyalakan.
 */
import { conn, line } from './probe.mjs';

const c = await conn();
const RUN = Date.now().toString(36);
let gagal = 0;
const cek = (ok, pesan) => { if (ok) line(`     OK     ${pesan}`); else { gagal++; line(`     GAGAL  ${pesan}`); } };

const aktif = async (kunci, tenant) =>
  (await c.query(`SELECT internal.fn_flag_aktif($1, $2::uuid) AS a`, [kunci, tenant])).rows[0].a;

/** Sekumpulan tenant untuk mengukur sebaran. */
const tenants = [];
for (let i = 0; i < 200; i++) {
  const ref = `own-flag-${RUN}-${i}`;
  const sektor = ['FNB', 'RETAIL', 'LAUNDRY', 'CARWASH', 'BARBERSHOP'][i % 5];
  const r = await c.query(
    `INSERT INTO internal.tenants (id,name,business_sector,external_ref,owner_user_ref)
     VALUES (uuidv7(),'Uji Bendera',$1,$2,$2) RETURNING id`, [sektor, ref]);
  tenants.push({ id: r.rows[0].id, sektor });
}

const pasang = (kunci, kolom) => c.query(
  `INSERT INTO internal.feature_flags (key, description, enabled, rollout_percent, sectors, tiers, allow_tenants, deny_tenants)
   VALUES ($1,'uji',$2,$3,$4,$5,$6,$7)
   ON CONFLICT (key) DO UPDATE SET enabled=EXCLUDED.enabled, rollout_percent=EXCLUDED.rollout_percent,
     sectors=EXCLUDED.sectors, tiers=EXCLUDED.tiers, allow_tenants=EXCLUDED.allow_tenants,
     deny_tenants=EXCLUDED.deny_tenants, updated_at=CURRENT_TIMESTAMP`,
  [kunci, kolom.enabled ?? true, kolom.percent ?? 0, kolom.sectors ?? null,
   kolom.tiers ?? null, kolom.allow ?? [], kolom.deny ?? []]);

// --- 1. Bendera tidak dikenal -----------------------------------------------
line('\n  1. Gagal-mati');
cek((await aktif(`tidak-ada-${RUN}`, tenants[0].id)) === false,
    'bendera yang TIDAK DIKENAL mati — salah ketik nama tidak menyalakan apa pun');
await pasang(`mati-${RUN}`, { enabled: false, percent: 100, allow: [tenants[0].id] });
cek((await aktif(`mati-${RUN}`, tenants[0].id)) === false,
    'enabled=false mengalahkan peluncuran 100% DAN daftar putih');

// --- 2. Peluncuran bertahap --------------------------------------------------
line('\n  2. Sebaran peluncuran bertahap');
for (const persen of [0, 1, 10, 50, 100]) {
  await pasang(`canary-${RUN}`, { percent: persen });
  let n = 0;
  for (const t of tenants) if (await aktif(`canary-${RUN}`, t.id)) n++;
  const nyata = (n / tenants.length) * 100;
  line(`     ${String(persen).padStart(3)}% diminta -> ${String(n).padStart(3)}/200 merchant (${nyata.toFixed(1)}%)`);
  if (persen === 0) cek(n === 0, '0% berarti benar-benar tidak ada');
  if (persen === 100) cek(n === 200, '100% berarti benar-benar semua');
  // Toleransi ±10 poin: 200 sampel pada undian hash tidak akan persis.
  if (persen === 50) cek(Math.abs(nyata - 50) < 10, `50% mendekati separuh (${nyata.toFixed(1)}%)`);
}

// --- 3. Stabil ---------------------------------------------------------------
line('\n  3. Jawaban stabil untuk merchant yang sama');
await pasang(`stabil-${RUN}`, { percent: 37 });
const pertama = [];
for (const t of tenants.slice(0, 30)) pertama.push(await aktif(`stabil-${RUN}`, t.id));
let berubah = 0;
for (let ulang = 0; ulang < 3; ulang++) {
  for (let i = 0; i < 30; i++) {
    if ((await aktif(`stabil-${RUN}`, tenants[i].id)) !== pertama[i]) berubah++;
  }
}
cek(berubah === 0, `30 merchant x 4 penilaian: tidak ada yang berubah jawaban (${berubah} perubahan)`);

// --- 4. Berbeda per bendera --------------------------------------------------
line('\n  4. Setiap bendera memilih himpunan yang BERBEDA');
await pasang(`a-${RUN}`, { percent: 30 });
await pasang(`b-${RUN}`, { percent: 30 });
const setA = new Set(); const setB = new Set();
for (const t of tenants) {
  if (await aktif(`a-${RUN}`, t.id)) setA.add(t.id);
  if (await aktif(`b-${RUN}`, t.id)) setB.add(t.id);
}
const irisan = [...setA].filter((x) => setB.has(x)).length;
const harapanIrisan = (setA.size * setB.size) / tenants.length;
line(`     bendera A: ${setA.size} merchant, bendera B: ${setB.size}, irisan ${irisan}`);
line(`     irisan yang diharapkan kalau keduanya bebas: ~${harapanIrisan.toFixed(0)}`);
cek(setA.size > 0 && setB.size > 0 && irisan < setA.size,
    'kedua bendera TIDAK memilih merchant yang sama persis');
cek(Math.abs(irisan - harapanIrisan) < tenants.length * 0.12,
    'irisannya sebesar kebetulan, bukan korban tetap');

// --- 5. Urutan penilaian -----------------------------------------------------
line('\n  5. Urutan: hitam > putih > penyaring > undian');
const korban = tenants[0].id;
const terpilih = tenants[1].id;
await pasang(`urutan-${RUN}`, { percent: 0, allow: [terpilih, korban], deny: [korban] });
cek((await aktif(`urutan-${RUN}`, terpilih)) === true,
    'daftar putih menyalakan meskipun peluncuran 0%');
cek((await aktif(`urutan-${RUN}`, korban)) === false,
    'daftar HITAM mengalahkan daftar putih — "jangan pernah" berarti jangan pernah');

await pasang(`urutan2-${RUN}`, { percent: 100, deny: [korban] });
cek((await aktif(`urutan2-${RUN}`, korban)) === false,
    'daftar hitam mengalahkan peluncuran 100%');

// --- 6. Penyaring sektor -----------------------------------------------------
line('\n  6. Penyaring sektor');
await pasang(`sektor-${RUN}`, { percent: 100, sectors: ['FNB'] });
const fnb = tenants.filter((t) => t.sektor === 'FNB');
const lain = tenants.filter((t) => t.sektor !== 'FNB');
let fnbAktif = 0; for (const t of fnb) if (await aktif(`sektor-${RUN}`, t.id)) fnbAktif++;
let lainAktif = 0; for (const t of lain) if (await aktif(`sektor-${RUN}`, t.id)) lainAktif++;
line(`     FNB ${fnbAktif}/${fnb.length} aktif, sektor lain ${lainAktif}/${lain.length}`);
cek(fnbAktif === fnb.length, 'seluruh merchant FNB menyala');
cek(lainAktif === 0, 'tidak satu pun sektor lain menyala');

await pasang(`sektor-kosong-${RUN}`, { percent: 100, sectors: [] });
let kosongAktif = 0; for (const t of tenants.slice(0, 20)) if (await aktif(`sektor-kosong-${RUN}`, t.id)) kosongAktif++;
cek(kosongAktif === 0, 'array sektor KOSONG berarti tidak satu pun — beda dari NULL');

await pasang(`sektor-null-${RUN}`, { percent: 100, sectors: null });
let nullAktif = 0; for (const t of tenants.slice(0, 20)) if (await aktif(`sektor-null-${RUN}`, t.id)) nullAktif++;
cek(nullAktif === 20, 'sektor NULL berarti SEMUA sektor');

// --- 7. Penyaring tier -------------------------------------------------------
line('\n  7. Penyaring tier paket');
await pasang(`tier-${RUN}`, { percent: 100, tiers: [3] });
cek((await aktif(`tier-${RUN}`, tenants[0].id)) === false,
    'merchant tanpa langganan dianggap tier 1, bukan lolos semua penyaring');
await pasang(`tier1-${RUN}`, { percent: 100, tiers: [1] });
cek((await aktif(`tier1-${RUN}`, tenants[0].id)) === true,
    'dan ia memang cocok ketika tier 1 yang disasar');

// --- Bersih-bersih -----------------------------------------------------------
await c.query(`DELETE FROM internal.feature_flags WHERE key LIKE $1`, [`%${RUN}%`]);
await c.query(`DELETE FROM internal.tenants WHERE external_ref LIKE $1`, [`own-flag-${RUN}-%`]);

line(gagal === 0
  ? '\n  >>> LULUS: peluncuran bertahap stabil, adil antar bendera, dan gagal-mati.\n'
  : `\n  >>> ${gagal} MASALAH.\n`);
await c.end();
process.exit(gagal === 0 ? 0 : 1);
