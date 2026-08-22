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
import { ADA_DB, db, tutupDb, bersihkanPemilik } from './helper-db';

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
        WHERE column_name = 'merchant_id' AND table_schema IN ('pos','ai','internal','billing')
        ORDER BY 1`
    );
    // Tiga tempat, dan ketiganya benar-benar berarti PEMILIK: unit usaha
    // menunjuk pemiliknya, langganan dimiliki pemiliknya (0028), dan staf
    // bekerja untuk pemiliknya (0033). Yang dijaga tes ini bukan "hanya satu
    // tabel", melainkan bahwa merchant_id tidak pernah lagi dipakai sebagai
    // nama lain untuk business_id — daftarnya ditulis tegas supaya kolom baru
    // bernama merchant_id harus dibenarkan lebih dulu.
    expect(rows.map((r: any) => r.t)).toEqual([
      'billing.subscriptions',
      'pos.businesses',
      'pos.staff_users',
    ]);
  });

  it('merchant staf tidak bisa berbeda dari merchant unit usahanya', async () => {
    // pos.staff_users.merchant_id adalah SALINAN dari businesses.merchant_id.
    // Salinan yang hanya dijaga kode aplikasi akan menyimpang suatu hari —
    // lewat perbaikan data manual, lewat skrip, lewat endpoint yang belum
    // ditulis. Yang dijaga di sini adalah bahwa databasenya sendiri menolak.
    const { rows } = await db().query(
      `SELECT COUNT(*)::int AS n FROM pg_constraint
        WHERE conname = 'fk_staff_merchant_sama_dengan_usaha'
          AND conrelid = 'pos.staff_users'::regclass`
    );
    expect(rows[0].n).toBe(1);

    // Dan tidak ada satu baris pun yang sudah terlanjur berbeda.
    const { rows: beda } = await db().query(
      `SELECT COUNT(*)::int AS n FROM pos.staff_users s
         JOIN pos.businesses b ON b.id = s.business_id
        WHERE s.merchant_id IS DISTINCT FROM b.merchant_id`
    );
    expect(beda[0].n).toBe(0);
  });

  it('langganan dimiliki merchant, dan tidak punya jalan lain ke business', async () => {
    const { rows } = await db().query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'billing' AND table_name = 'subscriptions'
          AND column_name IN ('business_id', 'tenant_id')`
    );
    // Selama kolomnya masih ada, satu INSERT yang lupa mengisi merchant_id
    // menghasilkan langganan kedua yang tidak terlihat entitlement mana pun.
    expect(rows).toEqual([]);
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
    await bersihkanPemilik('usr-hier_FNB');
    const { rows } = await db().query(
      `INSERT INTO pos.businesses (id, name, business_sector, client_key, owner_user_ref, is_active)
       VALUES (uuidv7(), 'Toko Hierarki', 'FNB', 'usr-hier_FNB', 'usr-hier', true)
       RETURNING merchant_id`
    );
    expect(rows[0].merchant_id).toBeTruthy();
  });

  it('outlet menempel pada business, terminal pada outlet', async () => {
    // Diambil business yang MEMANG punya outlet. `LIMIT 1` tanpa syarat itu
    // bisa mendarat pada unit usaha bikinan tes lain yang belum punya cabang,
    // dan tesnya gagal karena datanya, bukan karena hierarkinya salah.
    const { rows: pasangan } = await db().query(
      `SELECT b.id AS business_id, o.id AS outlet_id
         FROM pos.businesses b
         JOIN pos.outlets o ON o.business_id = b.id
        WHERE b.client_key IS NOT NULL
        ORDER BY b.created_at LIMIT 1`);
    expect(pasangan[0]).toBeDefined();
    const b = pasangan[0].business_id;
    const o = { id: pasangan[0].outlet_id };

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
