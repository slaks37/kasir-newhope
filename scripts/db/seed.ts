/**
 * Mengisi database dengan data demo di kelima sektor bisnis.
 *
 *   npx tsx scripts/db/seed.ts            # isi kalau masih kosong
 *   npx tsx scripts/db/seed.ts --force    # hapus data lama, isi ulang
 *
 * Salah satu pemilik sengaja menjalankan DUA sektor (kafe + laundry) dengan
 * business_id berbeda. Tanpa itu, kebocoran antar sektor tidak akan pernah
 * terlihat di data demo — dan justru itu yang paling perlu diuji.
 *
 * Angka acaknya deterministik (LCG dengan benih tetap), jadi dua kali seed
 * menghasilkan angka yang sama dan perbedaan pada layar berarti kode yang
 * berubah, bukan undian yang berbeda.
 */

import 'dotenv/config';
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
 * `owner` menentukan business_id (`${owner}_${sector}`). Dua baris dengan owner
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
             invoices, subscriptions, users, tenants
    RESTART IDENTITY CASCADE
  `);
}

async function main() {
  const force = process.argv.includes('--force');
  const db = await getDb((m) => console.log(m));

  if (await alreadySeeded(db)) {
    if (!force) {
      console.log('\nDatabase sudah berisi data. Pakai --force untuk mengisi ulang.');
      return;
    }
    console.log('\n--force: menghapus data lama…');
    await wipe(db);
  }

  const now = Date.now();
  let txnTotal = 0;
  let itemTotal = 0;
  let actTotal = 0;

  for (const m of MERCHANTS) {
    const cat = CATALOG[m.sector];
    const businessId = `${m.owner}_${m.sector}`;

    // external_ref WAJIB diisi. Itu satu-satunya kunci yang menghubungkan
    // partition key sisi klien (`${userId}_${sector}`) ke baris tenant — dipakai
    // endpoint sinkronisasi maupun AI Copilot. Tenant tanpa external_ref hanya
    // terlihat di admin panel dan tidak akan pernah bisa dijangkau copilot.
    const { rows: tRows } = await db.query(
      `INSERT INTO tenants (id, name, business_sector, is_active, created_at,
                            external_ref, owner_user_ref)
       VALUES (uuidv7(), $1, $2, TRUE, CURRENT_TIMESTAMP - ($3::int || ' days')::interval,
               $4, $5)
       RETURNING id`,
      [m.name, m.sector, m.days + 10, businessId, m.owner]
    );
    const tenantId: string = tRows[0].id;

    // Staf — terpisah per sektor, persis seperti di aplikasi.
    const staffIds: Array<{ id: string; name: string; role: string }> = [];
    const names = STAFF_BY_SECTOR[m.sector];
    for (let i = 0; i < names.length; i++) {
      const role = i === 0 ? 'MANAGER' : 'CASHIER';
      const { rows } = await db.query(
        `INSERT INTO users (id, tenant_id, name, username, pin, role)
         VALUES (uuidv7(), $1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, names[i], `${m.owner}.${m.sector.toLowerCase()}.${i}`, '0000', role]
      );
      staffIds.push({ id: rows[0].id, name: names[i], role });
    }

    // Katalog produk — juga terpisah per sektor.
    const productIds: Array<{
      id: string; name: string; cat: string; price: number; cost: number; desc: string;
    }> = [];
    for (const [name, category, price, cost, desc] of cat.items) {
      const { rows } = await db.query(
        `INSERT INTO products (id, tenant_id, name, sku, price, cost_price, is_available,
                               business_sector, business_id, category_name, description,
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
        `INSERT INTO subscriptions (id, tenant_id, plan_id, status,
                                    current_period_start, current_period_end)
         VALUES (uuidv7(), $1, $2, $3,
                 CURRENT_TIMESTAMP - INTERVAL '15 days', CURRENT_TIMESTAMP + INTERVAL '15 days')`,
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
        const hour = between(8, 21);
        const minute = between(0, 59);
        const appModule = pickOne(cat.modules);

        const { rows: xRows } = await db.query(
          `INSERT INTO transactions
             (id, tenant_id, cashier_user_id, subtotal, discount_amount, tax_amount,
              total_amount, payment_method, payment_status, business_sector, business_id,
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
            d, hour, minute,
          ]
        );
        const txnId: string = xRows[0].id;
        txnTotal++;

        for (const l of lines) {
          await db.query(
            `INSERT INTO transaction_items
               (id, transaction_id, tenant_id, product_id, product_name, unit_price,
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
               (merchant_id, tenant_id, business_sector, business_id, app_module,
                event_type, severity, actor_user_id, actor_name, actor_role,
                transaction_id, amount_idr, summary, detail, occurred_at)
             VALUES ($1, $1, $2, $3, $4, 'SALE', 'INFO', $5, $6, $7, $8, $9, $10, $11::jsonb,
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
           (merchant_id, tenant_id, business_sector, business_id, app_module,
            event_type, severity, actor_user_id, actor_name, actor_role,
            summary, detail, occurred_at)
         VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
                 CURRENT_TIMESTAMP - ($12::int || ' hours')::interval)`,
        [
          tenantId, m.sector, businessId, mod, type, sev,
          staff.id, staff.name, staff.role, summary, JSON.stringify(detail),
          between(1, m.days * 24),
        ]
      );
      actTotal++;
    }

    console.log(`  ${m.sector.padEnd(11)} ${m.name.padEnd(26)} business_id=${businessId}`);
  }

  console.log(
    `\nSelesai: ${MERCHANTS.length} merchant, ${txnTotal} transaksi, ${itemTotal} baris item, ${actTotal} kejadian.`
  );

  const { rows } = await db.query(
    `SELECT business_sector, COUNT(*)::int AS txn, SUM(total_amount) AS omzet
       FROM transactions GROUP BY business_sector ORDER BY omzet DESC`
  );
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
