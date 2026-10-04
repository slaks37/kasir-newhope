/**
 * Mengisi data demo di kelima sektor bisnis LEWAT API ASLI.
 *
 *   npm run dev          # terminal 1 — stack lokal + auth lokal
 *   npm run db:seed      # terminal 2
 *
 * Kenapa lewat API, bukan INSERT langsung: seeder lama menulis SQL mentah
 * mengikuti skema lama (tanpa merchant/outlet/payments) sehingga gagal di
 * skema sekarang, dan kalaupun berhasil transaksinya tidak terhitung di
 * laporan. Dengan memakai signup (trigger produksi), /sync/state (katalog),
 * /sync/transactions (penjualan + pembayaran + kas) dan /sync/activity, data
 * demo selalu melewati aturan bisnis yang sama dengan kasir sungguhan.
 *
 * Akun demo (KHUSUS lokal): demo-<owner>@newhope.local / Demo-pass-123.
 * Salah satu pemilik menjalankan DUA usaha (kafe + laundry) untuk menguji
 * pemisahan antar usaha. Angka acak deterministik (LCG benih tetap).
 */
import 'dotenv/config';
import crypto from 'node:crypto';

const API = (process.env.SEED_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const AUTH = (process.env.SUPABASE_URL || `http://127.0.0.1:${process.env.DEV_AUTH_PORT || 54321}`).replace(/\/$/, '');
const PASSWORD = 'Demo-pass-123';

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


const PAYMENTS = ['CASH', 'QRIS', 'DEBIT', 'GOPAY', 'OVO'] as const;
const today = () => new Date().toISOString().slice(0, 10);

async function request(token: string | null, method: string, path: string, body?: unknown) {
  const response = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(`${method} ${path} -> ${response.status} ${data?.error || ''}`);
  return data;
}

async function account(owner: string, first: (typeof MERCHANTS)[number]) {
  const email = `demo-${owner.replace(/^usr-/, '')}@newhope.local`;
  const post = (path: string, body: unknown) => fetch(AUTH + path, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: 'dev-local-anon' }, body: JSON.stringify(body) });
  let response = await post('/auth/v1/token?grant_type=password', { email, password: PASSWORD });
  if (!response.ok) response = await post('/auth/v1/signup', { email, password: PASSWORD, data: {
    full_name: owner.replace(/^usr-/, '').replace(/^./, c => c.toUpperCase()), store_name: first.name, business_sector: first.sector, first_outlet_name: `${first.name} — Cabang Utama` } });
  const session = await response.json();
  if (!session.access_token) throw new Error(`Login demo ${email} gagal: ${session.msg || response.status}. Apakah \`npm run dev\` sedang berjalan dengan auth lokal?`);
  return { email, token: session.access_token as string, userId: session.user.id as string };
}

async function businessFor(token: string, sector: Sector, name: string) {
  let directory = await request(token, 'GET', '/api/v1/sync/business');
  let business = directory.businesses.find((b: any) => b.sector === sector);
  if (!business) {
    await request(token, 'POST', '/api/v1/sync/business', { intent: 'create', requestKey: crypto.randomUUID(), sector, storeName: name });
    directory = await request(token, 'GET', '/api/v1/sync/business');
    business = directory.businesses.find((b: any) => b.sector === sector);
  }
  if (!business.outlets.some((o: any) => o.status === 'ACTIVE')) {
    await request(token, 'POST', '/api/v1/subscription/outlets', { businessId: business.businessId, businessSector: sector, name: `${name} — Cabang Utama` });
    directory = await request(token, 'GET', '/api/v1/sync/business');
    business = directory.businesses.find((b: any) => b.sector === sector);
  }
  return { businessId: business.businessId as string, transportRef: business.transportRef as string, outletId: business.outlets.find((o: any) => o.status === 'ACTIVE').outletId as string };
}

async function main() {
  console.log(`🗄️  API ${API} · Auth ${AUTH}`);
  const now = Date.now();
  let txnTotal = 0;
  for (const m of MERCHANTS) {
    const user = await account(m.owner, MERCHANTS.find(x => x.owner === m.owner)!);
    const biz = await businessFor(user.token, m.sector, m.name);
    const status = await request(user.token, 'GET', `/api/v1/sync/status?businessId=${encodeURIComponent(biz.transportRef)}`);
    if (Number(status.synced_transactions || 0) > 0) { console.log(`  ${m.sector.padEnd(11)} ${m.name.padEnd(26)} sudah terisi — dilewati`); continue; }

    const cat = CATALOG[m.sector];
    const products = cat.items.map(([name, category, price, cost, desc], index) => ({
      id: `demo-${m.sector.toLowerCase()}-${index + 1}`, name, categoryName: category, price, costPrice: cost, description: desc,
      sku: `${m.sector.slice(0, 3)}-${String(index + 1).padStart(3, '0')}`, unit: m.sector === 'LAUNDRY' && category === 'Kiloan' ? 'kg' : 'pcs',
      stock: between(20, 80), isAvailable: true,
    }));
    await request(user.token, 'POST', '/api/v1/sync/state', { sector: m.sector, businessId: biz.transportRef, outletId: biz.outletId,
      operations: products.map(value => ({ kind: 'products', recordId: value.id, baseRevision: 0, deleted: false, value })) });

    const sales: unknown[] = [];
    for (let d = m.days; d >= 0; d--) {
      if (m.name.includes('Vakum') && d < 26) continue;
      const isWeekend = new Date(now - d * 86400000).getDay() % 6 === 0;
      const count = between(m.perDay[0], m.perDay[1]) + (isWeekend ? 4 : 0);
      for (let k = 0; k < count; k++) {
        const lines = Array.from({ length: between(1, 3) }, () => pickOne(products)).map((p, i) => {
          const qty = p.unit === 'kg' ? between(2, 8) : between(1, 3);
          return { clientItemId: `i${i}`, productRef: p.id, productName: p.name, categoryName: p.categoryName, unitPrice: p.price, unitCost: p.costPrice, quantity: qty, totalPrice: p.price * qty };
        });
        const subtotal = lines.reduce((sum, line) => sum + line.totalPrice, 0);
        const discount = rnd() < 0.18 ? Math.round(subtotal * 0.1) : 0;
        const tax = Math.round((subtotal - discount) * 0.11);
        const created = new Date(new Date(now - d * 86400000).setHours(between(8, 21), between(0, 59), 0, 0));
        if (created.getTime() > now) created.setTime(now - between(1, 120) * 60000);
        sales.push({ clientTxnId: crypto.randomUUID(), invoiceNumber: `DEMO-${m.sector.slice(0, 3)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          cashierRef: user.userId, cashierName: 'Owner', items: lines, subtotal, discountAmount: discount, taxAmount: tax, serviceChargeAmount: 0,
          totalAmount: subtotal - discount + tax, paymentMethod: pickOne(PAYMENTS), paymentStatus: 'PAID', orderType: pickOne(cat.orderTypes),
          appModule: pickOne(cat.modules), createdAt: created.toISOString(), businessDate: created.toISOString().slice(0, 10) });
      }
    }
    for (let i = 0; i < sales.length; i += 200) {
      const batch = sales.slice(i, i + 200);
      await request(user.token, 'POST', '/api/v1/sync/transactions', { idempotencyKey: crypto.createHash('sha256').update(JSON.stringify(batch.map((t: any) => t.clientTxnId))).digest('hex'),
        businessId: biz.transportRef, outletId: biz.outletId, sector: m.sector, storeName: m.name, ownerRef: user.userId, transactions: batch });
    }
    for (const [eventType, appModule, severity, summary] of [
      ['STOCK_ADJUST', 'INVENTORY', 'NOTICE', `Penyesuaian stok manual ${pickOne(products).name}`],
      ['PRICE_CHANGE', 'SETTINGS', 'NOTICE', `Harga ${pickOne(products).name} diubah`],
      ['DISCOUNT_OVERRIDE', 'POS', 'WARNING', 'Diskon manual di atas 25% oleh kasir'],
      ['STOCK_CRITICAL', 'INVENTORY', 'CRITICAL', `Stok ${pickOne(products).name} habis saat jam sibuk`],
    ] as const) {
      await request(user.token, 'POST', '/api/v1/sync/activity', { businessId: biz.transportRef, appModule, eventType, severity, summary, actorName: 'Owner', actorRole: 'ADMIN' });
    }
    txnTotal += sales.length;
    console.log(`  ${m.sector.padEnd(11)} ${m.name.padEnd(26)} ${String(sales.length).padStart(5)} trx · ${user.email}`);
  }
  console.log(`\nSelesai: ${txnTotal} transaksi baru. Login demo: demo-<nama>@newhope.local / ${PASSWORD} (hanya lokal). Hari ini: ${today()}`);
}

main().then(() => process.exit(0), error => { console.error('\nSEED GAGAL:', error.message); process.exit(1); });
