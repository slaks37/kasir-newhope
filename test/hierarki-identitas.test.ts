/**
 * Hierarki identitas: Merchant -> Business -> Outlet -> Terminal.
 *
 * Yang dijaga di sini bukan sekadar "tabelnya ada", melainkan bahwa SATU
 * konsep punya SATU nama. Sebelum 0025 konsep "unit usaha" dipanggil tenant_id
 * di pos/billing, merchant_id di ai/internal/contract, sementara business_id
 * justru dipakai untuk kunci partisi penyimpanan klien. Setiap kueri lintas
 * skema harus mengingat nama mana yang berlaku di mana, dan satu kekeliruan
 * menghasilkan JOIN yang diam-diam kosong — bukan galat.
 *
 * Butuh Postgres yang sudah dimigrasi. Tanpa DATABASE_URL, dilewati.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { ADA_DB, db, tutupDb } from './helper-db';

const d = describe.skipIf(!ADA_DB);

d('satu konsep, satu nama', () => {
  afterAll(tutupDb);

  it('tidak ada lagi kolom tenant_id di mana pun', async () => {
    const { rows } = await db().query(
      `SELECT table_schema||'.'||table_name AS t FROM information_schema.columns
        WHERE column_name = 'tenant_id' AND table_schema IN ('pos','ai','internal','billing','contract')`
    );
    expect(rows.map((r: any) => r.t)).toEqual([]);
  });

  it('merchant_id hanya tersisa di tempat yang artinya PEMILIK', async () => {
    const { rows } = await db().query(
      `SELECT table_schema||'.'||table_name AS t FROM information_schema.columns
        WHERE column_name = 'merchant_id' AND table_schema IN ('pos','ai','internal','billing')`
    );
    expect(rows.map((r: any) => r.t)).toEqual(['pos.businesses']);
  });

  it('client_key adalah kunci partisi klien, bukan identitas usaha', async () => {
    const { rows } = await db().query(
      `SELECT client_key FROM pos.businesses WHERE client_key IS NOT NULL LIMIT 1`
    );
    // Bentuknya userId_SECTOR — dipakai perangkat untuk mengenali dirinya, dan
    // TIDAK dipakai sebagai kunci apa pun di sisi server.
    expect(rows[0].client_key).toMatch(/^.+_[A-Z]+$/);
  });
});

d('bentuk hierarki', () => {
  afterAll(tutupDb);

  it('satu merchant boleh memiliki beberapa business lintas sektor', async () => {
    const { rows } = await db().query(
      `SELECT m.name AS merchant, COUNT(DISTINCT b.id)::int AS jumlah,
              COUNT(DISTINCT b.business_sector)::int AS sektor
         FROM pos.merchants m JOIN pos.businesses b ON b.merchant_id = m.id
        GROUP BY m.id, m.name HAVING COUNT(DISTINCT b.id) > 1 LIMIT 1`
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].jumlah).toBeGreaterThan(1);
    expect(rows[0].sektor).toBeGreaterThan(1);
  });

  it('sektor adalah ATRIBUT business — bisa diubah tanpa mengubah identitas', async () => {
    const { rows } = await db().query(
      `SELECT id, business_sector FROM pos.businesses WHERE client_key IS NOT NULL LIMIT 1`);
    const id = rows[0].id;
    const semula = rows[0].business_sector;

    await db().query(`UPDATE pos.businesses SET business_sector = 'RETAIL' WHERE id = $1`, [id]);
    const sesudah = await db().query(`SELECT id, business_sector FROM pos.businesses WHERE id = $1`, [id]);

    // Identitasnya (id) TIDAK berubah — itulah bedanya klasifikasi dan identitas.
    expect(sesudah.rows[0].id).toBe(id);
    expect(sesudah.rows[0].business_sector).toBe('RETAIL');

    await db().query(`UPDATE pos.businesses SET business_sector = $2 WHERE id = $1`, [id, semula]);
  });

  it('setiap business punya merchant — tidak ada yang yatim', async () => {
    const { rows } = await db().query(
      `SELECT COUNT(*)::int n FROM pos.businesses
        WHERE owner_user_ref IS NOT NULL AND merchant_id IS NULL`);
    expect(rows[0].n).toBe(0);
  });

  it('business yang lahir kemudian ikut tertaut lewat trigger', async () => {
    await db().query(`DELETE FROM pos.businesses WHERE client_key = 'usr-hier_FNB'`);
    const { rows } = await db().query(
      `INSERT INTO pos.businesses (id, name, business_sector, client_key, owner_user_ref, is_active)
       VALUES (uuidv7(), 'Toko Hierarki', 'FNB', 'usr-hier_FNB', 'usr-hier', true)
       RETURNING merchant_id`
    );
    expect(rows[0].merchant_id).toBeTruthy();
  });

  it('outlet menempel pada business, terminal pada outlet', async () => {
    const b = (await db().query(
      `SELECT id FROM pos.businesses WHERE client_key IS NOT NULL LIMIT 1`)).rows[0].id;
    const o = (await db().query(
      `SELECT id FROM pos.outlets WHERE business_id = $1 LIMIT 1`, [b])).rows[0];
    expect(o).toBeDefined();

    await db().query(
      `INSERT INTO pos.terminals (id, business_id, outlet_id, device_ref, name)
       VALUES (uuidv7(), $1, $2, 'dev-uji-01', 'Kasir Depan')
       ON CONFLICT (business_id, device_ref) DO NOTHING`, [b, o.id]);

    const { rows } = await db().query(
      `SELECT terminal_name, outlet_name, business_name, merchant_name
         FROM contract.business_hierarchy WHERE device_ref = 'dev-uji-01'`);
    expect(rows[0].terminal_name).toBe('Kasir Depan');
    expect(rows[0].outlet_name).toBeTruthy();
    expect(rows[0].business_name).toBeTruthy();
    expect(rows[0].merchant_name).toBeTruthy();
  });
});
