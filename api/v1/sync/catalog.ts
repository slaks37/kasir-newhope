type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';
import { ENTITLEMENT_DARURAT } from '../../../src/lib/plans/entitlements.js';
import { wajibToko } from '../../_lib/tokoContext.js';
import { sslUntuk } from '../../../src/server/sslDb.js';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    // SSL wajib untuk database terkelola, dan mustahil untuk yang lokal —
    // Postgres di localhost menolak dengan "server does not support SSL".
    // Memaksanya membuat endpoint ini tidak bisa dijalankan atau diuji di mesin
    // sendiri sama sekali.
    const url = process.env.DATABASE_URL || '';

    pool = new pg.Pool({
      connectionString: url,
      ssl: sslUntuk(url),
      max: Number(process.env.PGPOOL_MAX || 2),
    });
  }
  return pool;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const body = req.body ?? {};
  const { businessId, sector, storeName, ownerRef, products, customers } = body;
  const prods = Array.isArray(products) ? products : [];
  // Aplikasi kasir SUDAH mengirim daftar member sejak lama (lihat pushCatalog
  // di src/lib/sync/queue.ts) — endpoint ini yang tidak pernah membacanya, dan
  // membuangnya diam-diam. Akibatnya seluruh data member hanya ada di perangkat
  // tempat ia diketik: hilang saat ganti perangkat, dan tidak pernah bisa
  // ditarik kembali.
  const members = Array.isArray(customers) ? customers : [];

  if (!businessId || !sector) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', detail: 'businessId and sector are required' });
  }

  const toko = await wajibToko(req, res, businessId);
  if (!toko) return;


  const db = getPool();
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    /*
     * 1. IDENTITAS UNIT USAHA — DIKUNCI PADA client_key, SEPERTI JALUR LAIN.
     *
     * Berkas ini memakai `legacy_uuid(businessId)`, sementara sync/transactions
     * mengunci pada `client_key`. Dua aturan identitas untuk satu konsep, dan
     * bedanya tidak muncul sebagai galat:
     *
     *   sinkron transaksi  -> business A (punya client_key, punya pemilik)
     *   sinkron katalog    -> business B (yatim: tanpa client_key, tanpa
     *                                     owner_user_ref, tanpa merchant)
     *
     * Produk merchant mendarat di baris yang TIDAK punya transaksinya, tidak
     * bisa ditemukan resolveTenantId, dan tidak punya langganan untuk
     * dibandingkan batasnya. Laporan tidak cocok, batas produk dihitung
     * terhadap baris yang salah, dan tidak ada satu pun pesan galat.
     *
     * Kekeliruan yang sama pernah diperbaiki di sync/transactions — komentar
     * di sana masih menjelaskannya — dan berkas ini terlewat.
     *
     * owner_user_ref ikut diisi supaya trigger dari 0025 menautkannya ke
     * merchant. Tanpa itu, unit usahanya tidak punya pemilik, dan langganan
     * yang menempel di merchant tidak akan pernah menemukannya.
     */
    const tenantRes = await client.query(
      `INSERT INTO pos.businesses (id, name, business_sector, client_key, owner_user_ref, is_active)
       VALUES (uuidv7(), $1, $2, $3, $4, true)
       ON CONFLICT (client_key) WHERE client_key IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name, business_sector = EXCLUDED.business_sector
       RETURNING id`,
      [storeName || 'New Hope Store', sector, businessId, ownerRef || businessId.split('_')[0] || null]
    );
    const tenantId = tenantRes.rows[0].id;

    /*
     * 2. BATAS PRODUK DITEGAKKAN DI SINI — sebelumnya TIDAK sama sekali.
     *
     * Jalur ini menyisipkan apa pun yang dikirim. Penegakan batas hanya ada di
     * sync/transactions (katalog yang lahir dari struk), sementara berkas ini —
     * jalur yang dipakai impor katalog langsung — melewatinya sepenuhnya.
     * Merchant paket Free bisa mengirim seribu produk lewat endpoint ini dan
     * seluruhnya masuk.
     *
     * Baru terlihat saat impor menu lewat OCR dibangun: fitur yang menjanjikan
     * "100 produk sekali unggah" akan menjadi jalan memutar mengelilingi
     * seluruh paywall, dari tombol yang kami sediakan sendiri.
     *
     * Tanpa baris langganan dipakai batas darurat, bukan "tanpa batas" —
     * merchant yang belum berlangganan bukan merchant dengan paket termahal.
     */
    const batasRes = await client.query(
      `SELECT product_limit FROM contract.merchant_entitlements WHERE business_id = $1`,
      [tenantId]
    );
    const batasProduk = batasRes.rows.length
      ? Number(batasRes.rows[0].product_limit)
      : ENTITLEMENT_DARURAT.productLimit;

    const jumlahRes = await client.query(
      `SELECT COUNT(*)::int AS n FROM pos.products WHERE business_id = $1`,
      [tenantId]
    );
    let jumlahProduk = jumlahRes.rows[0].n as number;
    const ditahan: string[] = [];

    // 3. Upsert Products
    for (const p of prods) {
      if (!p.name) continue;

      // Produk yang SUDAH ada selalu boleh diperbarui — menahan penyuntingan
      // saat batas terlampaui berarti merchant tidak bisa memperbaiki harga
      // yang salah, padahal itu justru yang paling mendesak.
      const sudahAda = await client.query(
        `SELECT 1 FROM pos.products WHERE id = legacy_uuid($1) AND business_id = $2`,
        [p.id || `prod-${p.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`, tenantId]
      );

      if (!sudahAda.rows.length) {
        if (batasProduk !== -1 && jumlahProduk >= batasProduk) {
          ditahan.push(String(p.name));
          continue;
        }
        jumlahProduk++;
      }

      await client.query(
        `INSERT INTO pos.products (
          id, business_id, name, sku, price, cost_price, is_available, description
        ) VALUES (
          legacy_uuid($1), $2, $3, $4, $5, $6, $7, $8
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          sku = EXCLUDED.sku,
          price = EXCLUDED.price,
          cost_price = EXCLUDED.cost_price,
          is_available = EXCLUDED.is_available,
          description = EXCLUDED.description`,
        [
          p.id || `prod-${p.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          tenantId,
          p.name,
          p.sku || `SKU-${Date.now()}`,
          Number(p.price) || 0,
          Number(p.costPrice) || 0,
          p.isAvailable ?? true,
          p.description || '',
        ]
      );
    }

    /* -- MEMBER TOKO ------------------------------------------------------ */
    //
    // Dicocokkan lewat external_ref, sama seperti produk. Angka loyalitas
    // ditimpa apa adanya dari perangkat kasir: menjumlahkan di server akan
    // menggandakan total belanja pada setiap kiriman ulang, dan kiriman ulang
    // adalah kejadian normal di sini.
    let memberTersimpan = 0;
    for (const c of members) {
      const ref = String(c?.externalRef ?? c?.ref ?? c?.id ?? '').trim().slice(0, 96);
      const nama = String(c?.name ?? '').trim().slice(0, 100);
      if (!ref || !nama) continue;

      await client.query(
        `INSERT INTO pos.customers
           (id, business_id, external_ref, name, phone, email, points, total_spent,
            visit_count, tier, last_visit_at, business_sector, client_key)
         VALUES (uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         -- Indeksnya PARSIAL (WHERE external_ref IS NOT NULL), jadi predikatnya
         -- harus ikut disebut. Tanpa itu Postgres tidak menemukan indeks yang
         -- cocok dan seluruh kiriman katalog gagal.
         ON CONFLICT (business_id, external_ref) WHERE external_ref IS NOT NULL
         DO UPDATE SET
           name = EXCLUDED.name,
           phone = EXCLUDED.phone,
           email = EXCLUDED.email,
           points = EXCLUDED.points,
           total_spent = EXCLUDED.total_spent,
           visit_count = EXCLUDED.visit_count,
           tier = EXCLUDED.tier,
           last_visit_at = EXCLUDED.last_visit_at`,
        [
          tenantId, ref, nama,
          String(c?.phone ?? '').slice(0, 32),
          String(c?.email ?? '').slice(0, 160),
          Math.max(0, Math.trunc(Number(c?.points) || 0)),
          Math.max(0, Number(c?.totalSpent) || 0),
          Math.max(0, Math.trunc(Number(c?.visitCount) || 0)),
          ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'].includes(String(c?.tier ?? '').toUpperCase())
            ? String(c.tier).toUpperCase() : 'BRONZE',
          c?.lastVisitAt ?? null,
          sector,
          businessId,
        ]
      );
      memberTersimpan += 1;
    }

    await client.query('COMMIT');

    return res.status(200).json({
      ok: true,
      synced: prods.length - ditahan.length,
      customersSynced: memberTersimpan,
      tenantId,
      productLimit: batasProduk,
      productCount: jumlahProduk,
      // Yang ditahan DISEBUT NAMANYA, bukan sekadar dihitung. Merchant yang
      // mengimpor 100 produk dan menerima "80 tersimpan" tanpa tahu dua puluh
      // mana yang hilang akan mengira sistemnya rusak.
      held: ditahan,
      message: ditahan.length
        ? `${prods.length - ditahan.length} produk tersimpan. ${ditahan.length} ditahan karena batas paket (${batasProduk}).`
        : 'Katalog tersinkronisasi.',
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[API Sync Catalog Error]:', err);
    return res.status(500).json({ ok: false, error: 'CATALOG_SYNC_FAILED' });
  } finally {
    client.release();
  }
}
