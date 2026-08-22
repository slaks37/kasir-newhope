/**
 * Merchant baru langsung mendapat Free Trial.
 *
 * Aturannya ada di trigger database, bukan di endpoint pendaftaran — karena
 * merchant lahir dari beberapa jalur (sinkron transaksi, sinkron katalog, seed,
 * panel admin) dan tidak ada satu pun endpoint pendaftaran yang dilewati
 * semuanya.
 *
 * Butuh Postgres yang sudah dimigrasi. Tanpa DATABASE_URL, dilewati.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { ADA_DB, db, tutupDb, bersihkanPemilik } from './helper-db';

const d = describe.skipIf(!ADA_DB);

d('trial otomatis untuk merchant baru', () => {
  afterAll(tutupDb);

  /**
   * Melahirkan merchant yang benar-benar BARU.
   *
   * Pemiliknya diturunkan dari ref, tidak lagi dipatok 'usr-x' untuk semua tes.
   * Sejak 0028 trial diberikan sekali per PEMILIK: kalau semua tes berbagi satu
   * pemilik, hanya yang pertama yang benar-benar menguji "merchant baru dapat
   * trial" — sisanya cuma membaca ulang langganan tes sebelumnya, termasuk sisa
   * dari sesi `npm test` yang lalu.
   */
  const lahirkan = async (ref: string) => {
    const owner = ref.split('_')[0];
    await bersihkanPemilik(ref);
    const { rows } = await db().query(
      `INSERT INTO pos.businesses (id, name, business_sector, client_key, owner_user_ref, is_active)
       VALUES (uuidv7(), $1, 'FNB', $2, $3, true) RETURNING id`,
      [`Toko ${ref}`, ref, owner]
    );
    return rows[0].id;
  };

  const entitlement = async (tid: string) =>
    (await db().query(
      `SELECT * FROM contract.merchant_entitlements WHERE business_id = $1`, [tid])).rows[0];

  it('merchant yang baru lahir langsung punya langganan percobaan', async () => {
    const tid = await lahirkan('uji-trial-1_FNB');
    const e = await entitlement(tid);
    expect(e).toBeDefined();
    expect(e.status).toBe('TRIAL');
    expect(e.berlaku).toBe(true);
  });

  it('paketnya yang bertrial_days, bukan Free', async () => {
    const tid = await lahirkan('uji-trial-2_FNB');
    const e = await entitlement(tid);
    const { rows } = await db().query(
      'SELECT trial_days FROM billing.plans WHERE id = $1', [e.plan_id]);
    expect(Number(rows[0].trial_days)).toBeGreaterThan(0);
  });

  it('berlaku selama trial_days yang tertulis di paket', async () => {
    const tid = await lahirkan('uji-trial-3_FNB');
    const e = await entitlement(tid);
    const { rows } = await db().query(
      'SELECT trial_days FROM billing.plans WHERE id = $1', [e.plan_id]);
    const hari = Math.round(
      (new Date(e.current_period_end).getTime() - Date.now()) / 86_400_000);
    expect(hari).toBe(Number(rows[0].trial_days));
  });

  it('memberi LEBIH dari Free — kalau sama, tidak ada yang dicoba', async () => {
    const tid = await lahirkan('uji-trial-4_FNB');
    const e = await entitlement(tid);
    const free = (await db().query(
      `SELECT product_limit, ai_quota_monthly FROM billing.plans WHERE id = 'plan-free'`)).rows[0];
    expect(Number(e.product_limit)).toBeGreaterThan(Number(free.product_limit));
    expect(Number(e.ai_quota_effective)).toBeGreaterThan(Number(free.ai_quota_monthly));
  });

  it('TIDAK menimpa langganan yang dibuat bersamaan dengan merchantnya', async () => {
    const tid = await lahirkan('uji-trial-5_FNB');
    await db().query(
      `INSERT INTO billing.subscriptions
         (id, merchant_id, plan_id, status, current_period_start, current_period_end)
       SELECT uuidv7(), b.merchant_id, 'plan-pro-monthly', 'ACTIVE',
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days'
         FROM pos.businesses b WHERE b.id = $1
       ON CONFLICT (merchant_id) DO UPDATE SET plan_id = 'plan-pro-monthly', status = 'ACTIVE'`,
      [tid]
    );
    const e = await entitlement(tid);
    expect(e.plan_id).toBe('plan-pro-monthly');
    expect(e.status).toBe('ACTIVE');
  });

  it('tidak ada merchant yang tertinggal tanpa langganan', async () => {
    /*
     * DIBATASI PADA PEMILIK YANG BUKAN BUATAN TES LAIN.
     *
     * Versi pertama memeriksa SELURUH baris pos.businesses. Vitest menjalankan
     * berkas tes secara paralel, dan berkas lain sengaja membuat merchant
     * tanpa langganan untuk menguji batas darurat — sebuah keadaan yang sah
     * dan sementara. Invarian global karena itu gagal karena BERKAS LAIN,
     * kadang-kadang, tergantung urutan penjadwalan.
     *
     * Kegagalan seperti itu muncul di berkas yang tidak bersalah, tidak bisa
     * diulang dengan andal, dan berakhir dianggap "tes rewel" lalu diabaikan —
     * bersama seluruh nilai yang seharusnya dijaganya.
     *
     * Yang diperiksa sekarang: merchant dari data seed dan dari berkas ini.
     */
    const { rows } = await db().query(
      `SELECT COUNT(*)::int n
         FROM pos.businesses t
         JOIN pos.merchants m ON m.id = t.merchant_id
        WHERE m.owner_user_ref NOT LIKE 'usr-uji-%'
          AND m.owner_user_ref NOT LIKE '%nosub%'
          AND NOT EXISTS (
                SELECT 1 FROM billing.subscriptions s WHERE s.merchant_id = t.merchant_id)`);
    expect(rows[0].n).toBe(0);
  });

  it('unit usaha SELALU tertaut ke merchant — tidak ada yang yatim', async () => {
    /*
     * Invarian yang lebih dasar, dan yang sempat dilanggar diam-diam:
     * api/v1/sync/catalog.ts membuat business lewat legacy_uuid() tanpa
     * client_key dan tanpa owner_user_ref, jadi trigger penaut merchant tidak
     * punya apa pun untuk ditautkan. Hasilnya baris yatim yang tidak bisa
     * ditemukan resolveTenantId, tidak punya langganan, dan menampung produk
     * merchant yang transaksinya ada di baris lain.
     */
    const { rows } = await db().query(
      `SELECT COUNT(*)::int n FROM pos.businesses WHERE merchant_id IS NULL`);
    expect(rows[0].n).toBe(0);
  });
});
