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
import { ADA_DB, db, tutupDb } from './helper-db';

const d = describe.skipIf(!ADA_DB);

d('trial otomatis untuk merchant baru', () => {
  afterAll(tutupDb);

  const lahirkan = async (ref: string) => {
    await db().query('DELETE FROM pos.businesses WHERE client_key = $1', [ref]);
    const { rows } = await db().query(
      `INSERT INTO pos.businesses (id, name, business_sector, client_key, owner_user_ref, is_active)
       VALUES (uuidv7(), $1, 'FNB', $2, 'usr-x', true) RETURNING id`,
      [`Toko ${ref}`, ref]
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
         (id, business_id, plan_id, status, current_period_start, current_period_end)
       VALUES (uuidv7(), $1, 'plan-pro-monthly', 'ACTIVE',
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days')
       ON CONFLICT (business_id) DO UPDATE SET plan_id = 'plan-pro-monthly', status = 'ACTIVE'`,
      [tid]
    );
    const e = await entitlement(tid);
    expect(e.plan_id).toBe('plan-pro-monthly');
    expect(e.status).toBe('ACTIVE');
  });

  it('tidak ada merchant yang tertinggal tanpa langganan', async () => {
    const { rows } = await db().query(
      `SELECT COUNT(*)::int n FROM pos.businesses t
        WHERE NOT EXISTS (SELECT 1 FROM billing.subscriptions s WHERE s.business_id = t.id)`);
    expect(rows[0].n).toBe(0);
  });
});
