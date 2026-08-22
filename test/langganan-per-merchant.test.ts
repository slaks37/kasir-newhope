/**
 * Langganan dimiliki MERCHANT, bukan unit usaha.
 *
 * Pemilik yang punya kafe dan laundry membeli SATU paket. Sebelum 0028,
 * billing.subscriptions dikunci UNIQUE(business_id): orang yang sama menanggung
 * dua langganan, dan jatah outletnya terbelah — 5 di kafe dan 5 lagi di
 * laundry, dari satu paket yang menjanjikan 5.
 *
 * Yang dijaga berkas ini adalah janji itu: satu pemilik, satu langganan, satu
 * jatah.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sinkronCabang from '../api/v1/sync/branches';
import { ADA_DB, db, tutupDb, pasangPaket, resTiruan, bersihkanPemilik } from './helper-db';

const d = describe.skipIf(!ADA_DB);

d('langganan per merchant', () => {
  const OWNER = 'usr-dua-usaha';
  const KAFE = `${OWNER}_FNB`;
  const LAUNDRY = `${OWNER}_LAUNDRY`;
  let idKafe = '';
  let idLaundry = '';

  /** Membuat unit usaha di bawah pemilik yang sama. */
  const buatUsaha = async (clientKey: string, sektor: string, nama: string) => {
    const { rows } = await db().query(
      `INSERT INTO pos.businesses (id, name, business_sector, client_key, owner_user_ref, is_active)
       VALUES (uuidv7(), $1, $2, $3, $4, true) RETURNING id`,
      [nama, sektor, clientKey, OWNER]
    );
    return rows[0].id as string;
  };

  beforeAll(async () => {
    await bersihkanPemilik(KAFE);
    idKafe = await buatUsaha(KAFE, 'FNB', 'Kopi Dua Usaha');
    idLaundry = await buatUsaha(LAUNDRY, 'LAUNDRY', 'Laundry Dua Usaha');
  });
  afterAll(tutupDb);

  it('dua unit usaha satu pemilik berbagi SATU baris langganan', async () => {
    const { rows } = await db().query(
      `SELECT s.id FROM billing.subscriptions s
         JOIN pos.merchants m ON m.id = s.merchant_id
        WHERE m.owner_user_ref = $1`,
      [OWNER]
    );
    expect(rows).toHaveLength(1);
  });

  it('trial diberikan sekali per PEMILIK, bukan per unit usaha', async () => {
    // Unit usaha kedua dibuat SETELAH yang pertama sudah punya trial. Kalau
    // trigger memberi trial baru, masa percobaan bisa diperpanjang tanpa batas
    // hanya dengan membuat unit usaha baru.
    const { rows } = await db().query(
      `SELECT s.created_at, s.current_period_end FROM billing.subscriptions s
         JOIN pos.merchants m ON m.id = s.merchant_id
        WHERE m.owner_user_ref = $1`,
      [OWNER]
    );
    expect(rows).toHaveLength(1);

    const sebelum = rows[0].current_period_end;
    await buatUsaha(`${OWNER}_RETAIL`, 'RETAIL', 'Toko Dua Usaha');
    const { rows: sesudah } = await db().query(
      `SELECT s.current_period_end FROM billing.subscriptions s
         JOIN pos.merchants m ON m.id = s.merchant_id
        WHERE m.owner_user_ref = $1`,
      [OWNER]
    );
    expect(sesudah).toHaveLength(1);
    expect(new Date(sesudah[0].current_period_end).getTime())
      .toBe(new Date(sebelum).getTime());
  });

  it('membayar dari satu unit usaha menyalakan entitlement di SEMUA unit usaha', async () => {
    await pasangPaket(idKafe, 'plan-pro-monthly');

    const { rows } = await db().query(
      `SELECT b.client_key, e.plan_id, e.status, e.berlaku
         FROM contract.merchant_entitlements e
         JOIN pos.businesses b ON b.id = e.business_id
        WHERE b.client_key IN ($1, $2) ORDER BY b.client_key`,
      [KAFE, LAUNDRY]
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.plan_id).toBe('plan-pro-monthly');
      expect(r.status).toBe('ACTIVE');
      expect(r.berlaku).toBe(true);
    }
  });

  it('jatah outlet dihitung SEMERCHANT, tidak berlipat per unit usaha', async () => {
    const batasPro = Number((await db().query(
      `SELECT max_outlets FROM billing.plans WHERE id = 'plan-pro-monthly'`)).rows[0].max_outlets);

    const cabang = (n: number, sektor: string) => ({
      id: `dua-${sektor}-${n}`, name: `Cabang ${sektor} ${n}`, address: `Jl. ${n}`,
      latitude: -6.2 - n / 100, longitude: 106.8 + n / 100,
      allowedRadiusMeters: 200, businessSector: sektor, isActive: true,
    });

    const kirim = async (businessId: string, branches: any[]) => {
      const res = resTiruan();
      await sinkronCabang({ method: 'POST', body: { businessId, branches } }, res);
      return res._body;
    };

    // Kafe memakai seluruh jatah.
    const h1 = await kirim(KAFE, Array.from({ length: batasPro }, (_, i) => cabang(i + 1, 'FNB')));
    expect(h1.activeOutlets).toBe(batasPro);
    expect(h1.remainingQuota).toBe(0);

    // Laundry milik pemilik yang SAMA tidak mendapat jatah baru.
    const h2 = await kirim(LAUNDRY, [cabang(1, 'LAUNDRY')]);
    expect(h2.saved).toBe(0);
    expect(h2.rejected).toHaveLength(1);
    expect(h2.remainingQuota).toBe(0);
  });

  it('MRR dihitung sekali per pemilik, bukan sekali per unit usaha', async () => {
    const { rows } = await db().query(
      `SELECT COUNT(*)::int baris,
              COUNT(*) FILTER (WHERE unit_penagihan)::int penagih,
              SUM(contracted_mrr_idr)::numeric kontrak,
              SUM(active_mrr_idr)::numeric     aktif,
              SUM(collected_mrr_idr)::numeric  masuk
         FROM contract.subscription_status s
         JOIN pos.businesses b ON b.id = s.business_id
        WHERE b.client_key LIKE $1`,
      [`${OWNER}\\_%`]
    );
    const harga = Number((await db().query(
      `SELECT price_idr FROM billing.plans WHERE id = 'plan-pro-monthly'`)).rows[0].price_idr);

    expect(rows[0].baris).toBeGreaterThan(1);        // beberapa unit usaha
    expect(rows[0].penagih).toBe(1);                 // satu yang membawa nominal
    expect(Number(rows[0].kontrak)).toBe(harga);     // ditagih sekali
    expect(Number(rows[0].aktif)).toBe(harga);       // langganannya memang berjalan
  });

  /*
   * "Langganan aktif" tidak sama dengan "uang sudah masuk".
   *
   * Sebelum 0030 view ini memberi `recognised_mrr_idr` yang isinya harga paket
   * untuk setiap langganan ACTIVE. Dashboard yang membacanya melaporkan
   * pendapatan yang belum tentu pernah diterima — dan angkanya bergerak ke
   * arah yang salah persis ketika keadaannya memburuk, karena merchant yang
   * pembayarannya gagal tetap ACTIVE sampai periodenya habis.
   */
  it('MRR yang MASUK hanya dihitung dari faktur yang benar-benar lunas', async () => {
    const { rows: sebelum } = await db().query(
      `SELECT SUM(collected_mrr_idr)::numeric n FROM contract.subscription_status s
         JOIN pos.businesses b ON b.id = s.business_id WHERE b.client_key LIKE $1`,
      [`${OWNER}\\_%`]
    );
    // Langganannya ACTIVE, tapi belum ada faktur lunas sama sekali.
    expect(Number(sebelum[0].n)).toBe(0);

    const { rows: sub } = await db().query(
      `SELECT s.id FROM billing.subscriptions s
         JOIN pos.merchants m ON m.id = s.merchant_id
        WHERE m.owner_user_ref = $1`, [OWNER]);
    await db().query(
      `INSERT INTO billing.invoices
         (id, subscription_id, business_id, invoice_number, plan_id, billing_cycle,
          amount, currency, payment_status, paid_at, due_date)
       VALUES (uuidv7(), $1, $2, $3, 'plan-pro-monthly', 'MONTHLY',
               299000, 'IDR', 'PAID', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [sub[0].id, idKafe, `INV-UJI-${Date.now()}`]
    );

    const { rows: sesudah } = await db().query(
      `SELECT SUM(collected_mrr_idr)::numeric n FROM contract.subscription_status s
         JOIN pos.businesses b ON b.id = s.business_id WHERE b.client_key LIKE $1`,
      [`${OWNER}\\_%`]
    );
    expect(Number(sesudah[0].n)).toBe(299000);
  });

  it('faktur TAHUNAN dibagi 12 supaya sebanding dengan bulanan', async () => {
    const { rows: sub } = await db().query(
      `SELECT s.id FROM billing.subscriptions s
         JOIN pos.merchants m ON m.id = s.merchant_id
        WHERE m.owner_user_ref = $1`, [OWNER]);
    await db().query(
      `INSERT INTO billing.invoices
         (id, subscription_id, business_id, invoice_number, plan_id, billing_cycle,
          amount, currency, payment_status, paid_at, due_date)
       VALUES (uuidv7(), $1, $2, $3, 'plan-pro-monthly', 'YEARLY',
               2868000, 'IDR', 'PAID', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [sub[0].id, idKafe, `INV-UJI-Y-${Date.now()}`]
    );

    const { rows } = await db().query(
      `SELECT SUM(collected_mrr_idr)::numeric n FROM contract.subscription_status s
         JOIN pos.businesses b ON b.id = s.business_id WHERE b.client_key LIKE $1`,
      [`${OWNER}\\_%`]
    );
    // 299.000 bulanan + 2.868.000/12 = 299.000 + 239.000
    expect(Number(rows[0].n)).toBe(299000 + 239000);
  });

  it('langganan tidak punya kolom business_id lagi', async () => {
    const { rows } = await db().query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'billing' AND table_name = 'subscriptions'
          AND column_name = 'business_id'`
    );
    expect(rows).toEqual([]);
  });
});
