/**
 * Mengisi database dengan data demo di kelima sektor bisnis.
 *
 *   npx tsx scripts/db/seed.ts            # isi kalau masih kosong
 *   npx tsx scripts/db/seed.ts --force    # hapus data lama, isi ulang
 *
 * Salah satu pemilik sengaja menjalankan DUA sektor (kafe + laundry) dengan
 * client_key berbeda. Tanpa itu, kebocoran antar sektor tidak akan pernah
 * terlihat di data demo — dan justru itu yang paling perlu diuji.
 *
 * Angka acaknya deterministik (LCG dengan benih tetap), jadi dua kali seed
 * menghasilkan angka yang sama dan perbedaan pada layar berarti kode yang
 * berubah, bukan undian yang berbeda.
 */

import 'dotenv/config';
import { INITIAL_BLOG_POSTS } from '../../src/lib/blogStorage';
import pg from 'pg';

/**
 * Seeder terhubung lewat jaringan seperti service lain, BUKAN dengan membuka
 * PGlite di dalam prosesnya sendiri. Kalau membuka sendiri, ia akan menjadi
 * penulis kedua atas direktori data yang sama — dan dua penulis pada PGlite
 * berarti salah satu diam-diam kalah.
 *
 * Seeder sengaja login sebagai superuser dengan search_path lintas skema: ia
 * alat operasional, bukan service. Batas skema berlaku untuk service, bukan
 * untuk perkakas yang memang tugasnya menyiapkan seluruh database.
 */
interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  exec(sql: string): Promise<void>;
}

async function getDb(log: (m: string) => void = () => {}): Promise<Db> {
  const connectionString =
    process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/postgres';
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query('SET search_path TO pos, billing, ai, internal, contract, public');
  log(`🗄️  Database: ${connectionString.replace(/:[^:@/]*@/, ':***@')}`);
  return {
    async query(sql, params) {
      const r = await client.query(sql, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    },
    async exec(sql) {
      await client.query(sql);
    },
  };
}

let seed = 20260813;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pickOne = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

/**
 * Bobot jam buka per sektor, dalam WIB.
 *
 * Versi sebelumnya memakai `between(8, 21)` — sebaran RATA sepanjang hari.
 * Akibatnya dua hal. Pertama, tidak ada jam sibuk sama sekali, jadi
 * OPERATIONAL_PEAK dan SHIFT_PERFORMANCE tidak pernah menemukan apa pun untuk
 * dilaporkan dan tidak pernah benar-benar teruji. Kedua, angkanya ditulis
 * sebagai jam UTC padahal dimaksudkan WIB, sehingga kafe di data ini paling
 * ramai jam 03.00 dini hari.
 *
 * Indeks = jam WIB 0-23. Angkanya bobot relatif, bukan persentase.
 */
const JAM_SIBUK: Record<string, number[]> = {
  //          0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  FNB:       [0, 0, 0, 0, 0, 0, 1, 3, 5, 4, 4, 6,12,10, 5, 4, 5, 7, 9,12, 8, 4, 2, 0],
  RETAIL:    [0, 0, 0, 0, 0, 0, 0, 1, 3, 5, 6, 7, 8, 7, 6, 6, 7, 9,11,10, 7, 4, 1, 0],
  LAUNDRY:   [0, 0, 0, 0, 0, 0, 0, 2, 7, 9, 8, 6, 4, 5, 6, 7, 8, 9, 7, 4, 1, 0, 0, 0],
  CARWASH:   [0, 0, 0, 0, 0, 0, 0, 3, 8,10, 9, 7, 5, 6, 7, 8, 8, 7, 5, 2, 1, 0, 0, 0],
  BARBERSHOP:[0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 5, 6, 6, 5, 5, 6, 7, 9,11,10, 6, 3, 1, 0],
};

/** Menarik satu jam WIB mengikuti bobot sektornya. */
function jamWib(sector: string): number {
  const bobot = JAM_SIBUK[sector] ?? JAM_SIBUK.RETAIL;
  const total = bobot.reduce((a, b) => a + b, 0);
  let n = rnd() * total;
  for (let j = 0; j < bobot.length; j++) {
    n -= bobot[j];
    if (n <= 0) return j;
  }
  return 12;
}

// [nama, kategori, harga jual, harga modal, deskripsi]
const CATALOG = {
  FNB: {
    store: 'New Hope Cafe & Resto',
    cat: 'Kuliner & Minuman',
    items: [
      ['Kopi Susu Gula Aren', 'Minuman', 22000, 7500, 'Espresso ganda dengan susu segar dan gula aren asli Jawa. Disajikan dingin.'],
      ['Americano', 'Minuman', 18000, 5000, 'Espresso murni dengan air panas. Tanpa gula, tanpa susu.'],
      ['Nasi Goreng Spesial', 'Makanan Berat', 35000, 13000, 'Nasi goreng kampung dengan telur mata sapi, ayam suwir, dan acar timun.'],
      ['Mie Goreng Jawa', 'Makanan Berat', 32000, 11000, 'Mie telur goreng bumbu kemiri, disajikan dengan kerupuk udang.'],
      ['Ayam Bakar Madu', 'Makanan Berat', 45000, 19000, 'Ayam kampung bakar bumbu madu, lalapan, dan sambal terasi.'],
      ['Kentang Goreng', 'Camilan', 20000, 6000, 'Kentang goreng renyah dengan saus keju atau sambal mayo.'],
      ['Es Teh Manis', 'Minuman', 8000, 1800, 'Teh tubruk melati diseduh segar, disajikan dengan es batu.'],
      ['Roti Bakar Coklat', 'Camilan', 18000, 5500, 'Roti gandum panggang dengan coklat leleh dan taburan keju.'],
    ],
    orderTypes: ['DINE_IN', 'TAKEAWAY', 'DELIVERY'],
    modules: ['POS', 'TABLES'],
  },
  LAUNDRY: {
    store: 'New Hope Laundry Express',
    cat: 'Jasa & Perawatan Pakaian',
    items: [
      ['Cuci Kering Kiloan', 'Kiloan', 7000, 2500, 'Cuci dan keringkan tanpa setrika. Selesai dalam 2 hari kerja.'],
      ['Cuci Setrika Kiloan', 'Kiloan', 10000, 3500, 'Paket lengkap cuci, kering, dan setrika rapi. Selesai 2 hari kerja.'],
      ['Setrika Saja Kiloan', 'Kiloan', 5000, 1500, 'Untuk pakaian yang sudah bersih. Selesai dalam 1 hari kerja.'],
      ['Bed Cover Besar', 'Satuan', 35000, 12000, 'Bed cover ukuran king dan queen. Cuci khusus mesin kapasitas besar.'],
      ['Jas / Blazer', 'Satuan', 25000, 9000, 'Dry clean untuk jas, blazer, dan kebaya. Digantung, tidak dilipat.'],
      ['Sepatu Sneakers', 'Satuan', 30000, 10000, 'Cuci manual dengan sikat halus, termasuk tali dan sol dalam.'],
      ['Karpet per Meter', 'Satuan', 20000, 7000, 'Cuci karpet dan permadani. Dijemur dua hari, harga per meter persegi.'],
    ],
    orderTypes: ['TAKEAWAY', 'DELIVERY'],
    modules: ['POS', 'CUSTOMERS'],
  },
  RETAIL: {
    store: 'New Hope Mart',
    cat: 'Perdagangan & Retail',
    items: [
      ['Beras Premium 5kg', 'Sembako', 68000, 58000, 'Beras pulen kepala, bebas kutu dan pemutih. Kemasan 5 kilogram.'],
      ['Minyak Goreng 2L', 'Sembako', 38000, 32000, 'Minyak goreng sawit dua kali penyaringan. Kemasan pouch 2 liter.'],
      ['Gula Pasir 1kg', 'Sembako', 17000, 14000, 'Gula kristal putih lokal. Kemasan 1 kilogram.'],
      ['Susu UHT 1L', 'Minuman', 21000, 17000, 'Susu sapi segar UHT tanpa gula tambahan. Kemasan karton 1 liter.'],
      ['Sabun Mandi Batang', 'Perawatan', 5500, 3800, 'Sabun batang antibakteri aroma sereh. Isi 85 gram.'],
      ['Mie Instan (dus)', 'Sembako', 118000, 102000, 'Mie instan goreng satu dus isi 40 bungkus. Harga grosir.'],
      ['Air Mineral 600ml', 'Minuman', 4000, 2400, 'Air minum dalam kemasan botol 600 ml.'],
    ],
    orderTypes: ['TAKEAWAY'],
    modules: ['POS', 'INVENTORY'],
  },
  CARWASH: {
    store: 'New Hope Auto Care',
    cat: 'Otomotif & Service',
    items: [
      ['Cuci Mobil Reguler', 'Cuci Mobil', 45000, 14000, 'Cuci badan luar, pelek, dan kaca. Lap kering manual. Sekitar 30 menit.'],
      ['Cuci Mobil + Wax', 'Cuci Mobil', 85000, 28000, 'Cuci reguler ditambah lapisan wax pelindung cat. Sekitar 60 menit.'],
      ['Cuci Motor', 'Cuci Motor', 20000, 6000, 'Cuci badan, pelek, dan rantai. Termasuk semir ban.'],
      ['Poles Body Mobil', 'Detailing', 250000, 90000, 'Menghilangkan baret halus dan jamur kaca. Perlu waktu 3 sampai 4 jam.'],
      ['Vacuum Interior', 'Detailing', 35000, 9000, 'Penyedotan debu jok, karpet, dan bagasi. Termasuk pengharum kabin.'],
      ['Semir Ban', 'Tambahan', 15000, 4000, 'Pengilap ban berbahan silikon. Tahan sekitar satu minggu.'],
    ],
    orderTypes: ['DINE_IN', 'TAKEAWAY'],
    modules: ['POS', 'TABLES'],
  },
  BARBERSHOP: {
    store: 'New Hope Barber & Salon',
    cat: 'Kecantikan & Perawatan Diri',
    items: [
      ['Potong Rambut Pria', 'Potong', 40000, 8000, 'Potong sesuai permintaan, termasuk rapikan garis leher. Sekitar 30 menit.'],
      ['Potong + Keramas', 'Potong', 55000, 12000, 'Potong rambut dilanjutkan keramas dan pijat kepala ringan.'],
      ['Cukur Jenggot', 'Grooming', 25000, 5000, 'Cukur pisau lipat dengan handuk hangat dan balsem penenang.'],
      ['Hair Coloring', 'Coloring', 180000, 65000, 'Pewarnaan rambut penuh dengan cat bebas amonia. Sekitar 2 jam.'],
      ['Creambath', 'Perawatan', 90000, 30000, 'Pijat kepala dan bahu dengan krim ginseng, diakhiri penataan rambut.'],
      ['Hair Tonic Treatment', 'Perawatan', 60000, 22000, 'Perawatan kulit kepala untuk rambut rontok. Disarankan rutin mingguan.'],
    ],
    orderTypes: ['DINE_IN'],
    modules: ['POS', 'TABLES'],
  },
} as const;

type Sector = keyof typeof CATALOG;

/**
 * `owner` menentukan client_key (`${owner}_${sector}`). Dua baris dengan owner
 * yang sama adalah SATU pemilik yang menjalankan dua usaha berbeda.
 */
const MERCHANTS: Array<{ owner: string; sector: Sector; name: string; days: number; perDay: [number, number] }> = [
  { owner: 'usr-budi',  sector: 'FNB',        name: 'Kopi Senja Kemang',        days: 60, perDay: [8, 22] },
  { owner: 'usr-budi',  sector: 'LAUNDRY',    name: 'Senja Laundry Kemang',     days: 60, perDay: [4, 12] },
  { owner: 'usr-siti',  sector: 'RETAIL',     name: 'Toko Berkah Siti',         days: 60, perDay: [10, 26] },
  { owner: 'usr-agus',  sector: 'CARWASH',    name: 'Agus Auto Wash',           days: 45, perDay: [3, 11] },
  { owner: 'usr-rina',  sector: 'BARBERSHOP', name: 'Rina Beauty Lounge',       days: 38, perDay: [4, 14] },
  // Merchant yang berhenti berjualan 26 hari lalu — bahan uji skor churn.
  // days harus melampaui ambang vakum di bawah, kalau tidak SEMUA harinya
  // terlewat dan merchant ini tidak punya transaksi sama sekali.
  { owner: 'usr-doni',  sector: 'FNB',        name: 'Warung Doni (Vakum)',      days: 60, perDay: [2, 6] },
];

const STAFF_BY_SECTOR: Record<Sector, string[]> = {
  FNB: ['Barista Andi', 'Kasir Mega', 'Chef Bayu'],
  LAUNDRY: ['Petugas Wati', 'Kasir Lina'],
  RETAIL: ['Kasir Dewi', 'Gudang Fajar'],
  CARWASH: ['Teknisi Rudi', 'Kasir Nina'],
  BARBERSHOP: ['Kapster Yoga', 'Kasir Tari'],
};

const PAYMENTS = ['CASH', 'QRIS', 'DEBIT', 'GOPAY', 'OVO'] as const;

async function alreadySeeded(db: Db) {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM transactions`);
  return (rows[0]?.n ?? 0) > 0;
}

async function wipe(db: Db) {
  // Urutan mengikuti arah foreign key. merchant_activity_log lebih dulu karena
  // menunjuk transactions.
  await db.exec(`
    TRUNCATE merchant_activity_log, sync_receipts, transaction_items, transactions,
             inventory_logs, product_recipes, products, ingredients,
             merchant_health_logs, feature_usage_events, daily_merchant_insights,
             merchant_ai_credits, merchant_targets, ai_query_logs,
             invoices, subscriptions, user_roles, staff_users, auth_users,
             businesses, merchants
    RESTART IDENTITY CASCADE
  `);
}

/**
 * Artikel blog awal.
 *
 * Sampai blog punya tabel, INITIAL_BLOG_POSTS adalah yang dilihat pengunjung —
 * dan yang ditulis admin tidak pernah sampai ke mana-mana. Sekarang isinya
 * dipindahkan ke database sekali, dan panel yang menjadi sumbernya.
 *
 * Hanya bila tabelnya KOSONG. Menimpanya di tiap seed akan menghapus artikel
 * yang benar-benar ditulis orang.
 */
async function seedBlog(db: Db) {
  const { rows } = await db.query('SELECT COUNT(*)::int n FROM internal.blog_posts');
  if ((rows[0]?.n ?? 0) > 0) {
    console.log(`  blog: ${rows[0].n} artikel sudah ada, dilewati`);
    return;
  }

  for (const p of INITIAL_BLOG_POSTS) {
    await db.query(
      `INSERT INTO internal.blog_posts
         (id, slug, title, excerpt, content, category, cover_image, author,
          reading_time_minutes, tags, media_embeds, seo, is_published, is_featured,
          view_count, likes_count, published_at)
       VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb,
               $11::jsonb, $12, $13, $14, $15,
               CASE WHEN $12 THEN CURRENT_TIMESTAMP ELSE NULL END)
       ON CONFLICT (slug) DO NOTHING`,
      [
        p.slug, p.title, p.excerpt, p.content, p.category, p.coverImage,
        JSON.stringify(p.author), p.readingTimeMinutes, p.tags,
        JSON.stringify(p.mediaEmbeds), JSON.stringify(p.seo),
        p.isPublished, p.isFeatured ?? false, p.viewCount ?? 0, p.likesCount ?? 0,
      ]
    );
  }
  console.log(`  blog: ${INITIAL_BLOG_POSTS.length} artikel awal dimasukkan`);
}

/**
 * Menolak berjalan terhadap database yang bukan milik mesin sendiri.
 *
 * Berkas ini memasukkan merchant contoh — "Toko Berkah Siti", "Warung Doni
 * (Vakum)" — dan `--force` MENGHAPUS SELURUH ISI database lebih dulu. Satu
 * `DATABASE_URL` yang tertinggal di shell dari sesi lain sudah cukup untuk
 * menjalankannya terhadap data merchant sungguhan, dan tidak ada satu langkah
 * pun setelahnya yang bisa membatalkannya.
 *
 * Pagarnya di sini, bukan di dokumentasi: perkakas yang bisa menghapus
 * produksi harus menolak sendiri, bukan mengandalkan orang membaca komentar
 * lebih dulu.
 */
function pastikanDatabaseLokal(url: string): void {
  const lokal = /@(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(url) || /host=\//.test(url);
  if (lokal) return;

  // Satu pintu keluar yang harus disengaja, untuk lingkungan uji terkelola
  // di CI yang memang databasenya jauh tapi memang boleh dihapus.
  if (process.env.SEED_IZINKAN_NONLOKAL === '1') {
    console.warn('[seed] SEED_IZINKAN_NONLOKAL=1 — melanjutkan ke database non-lokal.');
    return;
  }

  console.error(
    '\n[seed] DITOLAK: DATABASE_URL menunjuk database yang bukan lokal.\n' +
    '       Berkas ini memasukkan merchant contoh dan --force menghapus\n' +
    '       seluruh isinya lebih dulu.\n\n' +
    '       Kalau memang disengaja, jalankan dengan SEED_IZINKAN_NONLOKAL=1.\n'
  );
  process.exit(1);
}

async function main() {
  const force = process.argv.includes('--force');
  pastikanDatabaseLokal(process.env.DATABASE_URL || '');
  const db = await getDb((m) => console.log(m));

  // --force MENGHAPUS TANPA SYARAT.
  //
  // Dulu penghapusan digantung pada alreadySeeded(), yang memeriksa apakah ada
  // transaksi. Seed yang gagal di tengah jalan meninggalkan merchant tanpa
  // transaksi — keadaan yang lolos pemeriksaan itu — sehingga --force melewati
  // penghapusan lalu langsung menabrak client_key yang sudah ada. "Force"
  // yang menolak bekerja justru pada keadaan berantakan tidak menolong siapa
  // pun; di situlah ia paling dibutuhkan.
  if (force) {
    console.log('\n--force: menghapus data lama…');
    await wipe(db);
  } else if (await alreadySeeded(db)) {
    console.log('\nDatabase sudah berisi data. Pakai --force untuk mengisi ulang.');
    return;
  }

  const now = Date.now();
  let txnTotal = 0;
  let itemTotal = 0;
  let actTotal = 0;
  // Berapa outlet yang sudah dipakai tiap PEMILIK — jatahnya semerchant, dan
  // usr-budi punya dua unit usaha yang berbagi jatah itu.
  const outletTerpakai = new Map<string, number>();

  for (const m of MERCHANTS) {
    const cat = CATALOG[m.sector];
    const businessId = `${m.owner}_${m.sector}`;

    // client_key WAJIB diisi. Itu satu-satunya kunci yang menghubungkan
    // partition key sisi klien (`${userId}_${sector}`) ke baris tenant — dipakai
    // endpoint sinkronisasi maupun AI Copilot. Business tanpa client_key hanya
    // terlihat di admin panel dan tidak akan pernah bisa dijangkau copilot.
    const { rows: tRows } = await db.query(
      `INSERT INTO businesses (id, name, business_sector, is_active, created_at,
                            client_key, owner_user_ref)
       VALUES (uuidv7(), $1, $2, TRUE, CURRENT_TIMESTAMP - ($3::int || ' days')::interval,
               $4, $5)
       RETURNING id`,
      [m.name, m.sector, m.days + 10, businessId, m.owner]
    );
    const tenantId: string = tRows[0].id;

    // Cabang. Jumlahnya sengaja bervariasi supaya panel admin punya ketiga
    // keadaan yang perlu bisa dibedakan staf support: merchant yang mentok
    // batas outletnya, yang masih longgar, dan yang baru punya satu.
    //
    // Batasnya DIBACA dari paket tertinggi, tidak dipatok di sini. Angka yang
    // diketik ulang akan berbohong pada perubahan katalog berikutnya — dan
    // pernah berbohong: komentar ini dulu menyebut "4 outlet" ketika Pro sudah
    // menjadi 5.
    const { rows: batasRows } = await db.query(
      `SELECT max_outlets FROM plans ORDER BY tier_level DESC LIMIT 1`
    );
    const batasOutlet = Number(batasRows[0]?.max_outlets ?? 1);

    // Jatah outlet berlaku SEMERCHANT sejak 0028, bukan per unit usaha. Tanpa
    // pemotongan di bawah, usr-budi mendapat 5 outlet di kafenya DAN 2 lagi di
    // laundrynya — 7 outlet dari satu langganan Pro yang menjanjikan 5, dan
    // seed langsung melahirkan keadaan yang ditolak servernya sendiri.
    const dipakaiPemilik = outletTerpakai.get(m.owner) ?? 0;
    const diinginkan =
      m.owner === 'usr-budi' && m.sector === 'FNB' ? batasOutlet - 1 : m.days >= 60 ? 2 : 1;
    const jumlahCabang = Math.max(1, Math.min(diinginkan, batasOutlet - dipakaiPemilik));
    outletTerpakai.set(m.owner, dipakaiPemilik + jumlahCabang);
    let cabangUtama: string | null = null;
    for (let i = 0; i < jumlahCabang; i++) {
      const { rows } = await db.query(
        `INSERT INTO outlets
           (id, business_id, external_ref, name, address, latitude, longitude,
            allowed_radius_meters, business_sector, is_active)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, 200, $7, TRUE)
         RETURNING id`,
        [
          tenantId,
          `branch-${businessId}-${i}`,
          i === 0 ? `${m.name} - Pusat` : `${m.name} - Cabang ${i + 1}`,
          i === 0 ? 'Jl. Utama No. 1' : `Jl. Cabang ${i + 1} No. ${i + 1}`,
          -6.2215 - i / 100,
          106.8014 + i / 100,
          m.sector,
        ]
      );
      if (i === 0) cabangUtama = rows[0].id;
    }
    await db.query(`UPDATE businesses SET active_outlet_id = $2 WHERE id = $1`, [
      tenantId,
      cabangUtama,
    ]);

    // Staf — terpisah per sektor, persis seperti di aplikasi.
    //
    // Sejak 0033 satu orang berarti TIGA baris: kredensialnya, catatan
    // kepegawaiannya, dan perannya. Seed sengaja menulis ketiganya supaya data
    // contoh punya bentuk yang sama dengan data sungguhan — kalau hanya menulis
    // staff_users, seluruh staf contoh akan tampak "belum diberi login" dan
    // layar Kelola Staf tidak pernah teruji dengan baris yang lengkap.
    const staffIds: Array<{ id: string; name: string; role: string }> = [];
    const names = STAFF_BY_SECTOR[m.sector];
    for (let i = 0; i < names.length; i++) {
      const role = i === 0 ? 'MANAGER' : 'CASHIER';
      const login = `${m.owner}.${m.sector.toLowerCase()}.${i}`;
      const kredensial = await db.query(
        `INSERT INTO auth_users (id, business_id, login, pin)
         VALUES (uuidv7(), $1, $2, $3)
         ON CONFLICT (business_id, login) DO UPDATE SET pin = EXCLUDED.pin
         RETURNING id`,
        [tenantId, login, '0000']
      );
      const { rows } = await db.query(
        // merchant_id dibaca dari businesses, tidak diketik ulang: ia diisi
        // trigger saat unit usaha dibuat, dan menyalinnya di sini berarti seed
        // menebak nilai yang sudah ada jawabannya.
        `INSERT INTO staff_users
           (id, business_id, merchant_id, auth_user_id, name, employee_code, status, joined_at)
         SELECT uuidv7(), b.id, b.merchant_id, $2, $3, $4, 'AKTIF', CURRENT_TIMESTAMP
           FROM businesses b WHERE b.id = $1
         RETURNING id`,
        [tenantId, kredensial.rows[0].id, names[i], `${login}.staf`]
      );
      await db.query(
        `INSERT INTO user_roles (staff_user_id, role_code) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [rows[0].id, role]
      );
      staffIds.push({ id: rows[0].id, name: names[i], role });
    }

    // Katalog produk — juga terpisah per sektor.
    const productIds: Array<{
      id: string; name: string; cat: string; price: number; cost: number; desc: string;
    }> = [];
    for (const [name, category, price, cost, desc] of cat.items) {
      const { rows } = await db.query(
        `INSERT INTO products (id, business_id, name, sku, price, cost_price, is_available,
                               business_sector, client_key, category_name, description,
                               stock, min_stock_alert, unit, catalog_synced_at)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, TRUE, $6, $7, $8, $9, $10, $11, $12,
                 CURRENT_TIMESTAMP) RETURNING id`,
        [
          tenantId,
          name,
          `${m.sector.slice(0, 3)}-${name.replace(/[^A-Za-z]/g, '').slice(0, 6).toUpperCase()}`,
          price,
          cost,
          m.sector,
          businessId,
          category,
          desc,
          between(0, 80),
          10,
          m.sector === 'LAUNDRY' ? 'kg' : 'pcs',
        ]
      );
      productIds.push({ id: rows[0].id, name, cat: category, price, cost, desc });
    }

    // Langganan.
    const { rows: planRows } = await db.query(`SELECT id FROM plans ORDER BY tier_level DESC LIMIT 1`);
    if (planRows.length) {
      await db.query(
        // MENIMPA, bukan menyisipkan. Sejak 0024 setiap merchant baru langsung
        // mendapat langganan percobaan dari trigger, jadi barisnya sudah ada
        // sebelum baris ini dijalankan.
        // Kuncinya MERCHANT sejak 0028 — langganan milik pemilik, bukan unit
        // usaha. Seed memakai satu unit usaha per pemilik, jadi pemetaannya
        // satu-ke-satu, tapi kuncinya tetap harus benar.
        `INSERT INTO subscriptions (id, merchant_id, plan_id, status,
                                    current_period_start, current_period_end)
         SELECT uuidv7(), b.merchant_id, $2, $3,
                CURRENT_TIMESTAMP - INTERVAL '15 days', CURRENT_TIMESTAMP + INTERVAL '15 days'
           FROM businesses b WHERE b.id = $1
         ON CONFLICT (merchant_id) DO UPDATE SET
           plan_id              = EXCLUDED.plan_id,
           status               = EXCLUDED.status,
           current_period_start = EXCLUDED.current_period_start,
           current_period_end   = EXCLUDED.current_period_end`,
        [tenantId, planRows[0].id, m.name.includes('Vakum') ? 'PAST_DUE' : 'ACTIVE']
      );
    }

    // Transaksi harian.
    for (let d = m.days; d >= 0; d--) {
      // Merchant vakum berhenti total 26 hari lalu.
      if (m.name.includes('Vakum') && d < 26) continue;

      const isWeekend = new Date(now - d * 86400000).getDay() % 6 === 0;
      const count = between(m.perDay[0], m.perDay[1]) + (isWeekend ? 4 : 0);

      for (let k = 0; k < count; k++) {
        const staff = pickOne(staffIds);
        const nItems = between(1, 3);
        const chosen: typeof productIds = [];
        for (let z = 0; z < nItems; z++) chosen.push(pickOne(productIds));

        let subtotal = 0;
        const lines = chosen.map((p) => {
          const qty = m.sector === 'LAUNDRY' && p.cat === 'Kiloan' ? between(2, 8) : between(1, 3);
          const total = p.price * qty;
          subtotal += total;
          return { p, qty, total };
        });

        const discount = rnd() < 0.18 ? Math.round(subtotal * 0.1) : 0;
        const tax = Math.round((subtotal - discount) * 0.11);
        const grand = subtotal - discount + tax;
        // Jam ditarik dalam WIB lalu DISIMPAN sebagai UTC — sama seperti yang
        // dikirim perangkat sungguhan. Menyimpan jam WIB apa adanya membuat
        // setiap pembacaan yang benar (UTC + 7) menggeser data tujuh jam lagi.
        const jam = jamWib(m.sector);
        const hour = (jam - 7 + 24) % 24;
        // Tanggalnya ikut mundur untuk jam 00-06 WIB, yang jatuh di hari
        // sebelumnya dalam UTC.
        const geserHari = jam < 7 ? 1 : 0;
        const minute = between(0, 59);
        const appModule = pickOne(cat.modules);

        const { rows: xRows } = await db.query(
          `INSERT INTO transactions
             (id, business_id, cashier_user_id, subtotal, discount_amount, tax_amount,
              total_amount, payment_method, payment_status, business_sector, client_key,
              app_module, order_type, invoice_number, created_at)
           VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, 'COMPLETED', $8, $9, $10, $11, $12,
                   (CURRENT_DATE - ($13::int))::timestamptz
                     + ($14::int || ' hours')::interval + ($15::int || ' minutes')::interval)
           RETURNING id, created_at`,
          [
            tenantId, staff.id, subtotal, discount, tax, grand,
            pickOne(PAYMENTS), m.sector, businessId, appModule,
            pickOne(cat.orderTypes),
            `INV-${m.sector.slice(0, 3)}-${String(txnTotal + 1).padStart(6, '0')}`,
            d + geserHari, hour, minute,
          ]
        );
        const txnId: string = xRows[0].id;
        txnTotal++;

        for (const l of lines) {
          await db.query(
            `INSERT INTO transaction_items
               (id, transaction_id, business_id, product_id, product_name, unit_price,
                quantity, total_price, business_sector, category_name, unit_cost,
                product_description)
             VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [txnId, tenantId, l.p.id, l.p.name, l.p.price, l.qty, l.total, m.sector,
             l.p.cat, l.p.cost, l.p.desc]
          );
          itemTotal++;
        }

        // Jejak aktivitas untuk penjualan. Tidak semua dicatat — 1 dari 4 —
        // supaya log tidak menjadi salinan tabel transaksi.
        if (rnd() < 0.25) {
          await db.query(
            `INSERT INTO merchant_activity_log
               (business_id, business_sector, client_key, app_module,
                event_type, severity, actor_user_id, actor_name, actor_role,
                transaction_id, amount_idr, summary, detail, occurred_at)
             VALUES ($1, $2, $3, $4, 'SALE', 'INFO', $5, $6, $7, $8, $9, $10, $11::jsonb,
                     (SELECT created_at FROM transactions WHERE id = $8))`,
            [
              tenantId, m.sector, businessId, appModule, staff.id, staff.name, staff.role,
              txnId, grand,
              `Penjualan ${lines.length} item — ${lines[0].p.name}${lines.length > 1 ? ' dll' : ''}`,
              JSON.stringify({ items: lines.length, discount, payment: 'COMPLETED' }),
            ]
          );
          actTotal++;
        }
      }
    }

    // Kejadian non-penjualan — inilah yang membuat log ini lebih dari sekadar
    // salinan tabel transaksi.
    const events: Array<[string, string, string, string, Record<string, unknown>]> = [
      ['STOCK_ADJUST', 'INVENTORY', 'NOTICE', `Penyesuaian stok manual ${pickOne(productIds).name}`, { delta: -between(2, 9) }],
      ['PRICE_CHANGE', 'SETTINGS', 'NOTICE', `Harga ${pickOne(productIds).name} diubah`, { by: 'OWNER' }],
      ['LOGIN_FAILED', 'AUTH', 'WARNING', 'PIN salah 3x berturut-turut', { attempts: 3 }],
      ['DISCOUNT_OVERRIDE', 'POS', 'WARNING', 'Diskon manual di atas 25% oleh kasir', { pct: between(26, 45) }],
      ['STOCK_CRITICAL', 'INVENTORY', 'CRITICAL', `Stok ${pickOne(productIds).name} habis saat jam sibuk`, { remaining: 0 }],
      ['SHIFT_OPEN', 'SETTINGS', 'INFO', 'Shift pagi dibuka', { cash_float: 200000 }],
      ['AI_QUERY', 'AI', 'INFO', 'Bertanya ke AI Copilot soal stok kritis', { source: 'RULE', credits: 0 }],
      ['REPORT_EXPORT', 'REPORTS', 'INFO', 'Ekspor laporan penjualan bulanan', { format: 'csv' }],
    ];

    for (const [type, mod, sev, summary, detail] of events) {
      const staff = pickOne(staffIds);
      await db.query(
        `INSERT INTO merchant_activity_log
           (business_id, business_sector, client_key, app_module,
            event_type, severity, actor_user_id, actor_name, actor_role,
            summary, detail, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
                 CURRENT_TIMESTAMP - ($12::int || ' hours')::interval)`,
        [
          tenantId, m.sector, businessId, mod, type, sev,
          staff.id, staff.name, staff.role, summary, JSON.stringify(detail),
          between(1, m.days * 24),
        ]
      );
      actTotal++;
    }

    console.log(`  ${m.sector.padEnd(11)} ${m.name.padEnd(26)} client_key=${businessId}`);
  }

  console.log(
    `\nSelesai: ${MERCHANTS.length} merchant, ${txnTotal} transaksi, ${itemTotal} baris item, ${actTotal} kejadian.`
  );

  const { rows } = await db.query(
    `SELECT business_sector, COUNT(*)::int AS txn, SUM(total_amount) AS omzet
       FROM transactions GROUP BY business_sector ORDER BY omzet DESC`
  );
  await seedBlog(db);

  console.log('\nPer sektor:');
  for (const r of rows) {
    console.log(
      `  ${String(r.business_sector).padEnd(11)} ${String(r.txn).padStart(5)} txn   Rp ${Number(r.omzet).toLocaleString('id-ID')}`
    );
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('\nSEED GAGAL:', err.message);
    process.exit(1);
  }
);
