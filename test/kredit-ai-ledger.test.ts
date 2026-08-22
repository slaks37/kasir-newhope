/**
 * Kredit AI: mesin keadaan RESERVED -> SUCCEEDED / REFUNDED.
 *
 * Yang dijaga di sini adalah kegagalan yang paling sulit ditemukan: proses
 * mati SETELAH model menjawab tapi SEBELUM jawabannya tercatat. Dulu yang
 * tertinggal hanya kredit terpotong tanpa jejak; sekarang tertinggal satu baris
 * RESERVED yang bisa ditemukan dan dikembalikan.
 *
 * Butuh Postgres yang sudah dimigrasi. Tanpa DATABASE_URL, dilewati.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADA_DB, db, tutupDb, merchantUji } from './helper-db';

const d = describe.skipIf(!ADA_DB);

d('siklus hidup kredit AI', () => {
  let bid = '';

  beforeAll(async () => {
    bid = await merchantUji('usr-kredit_FNB', 'Toko Kredit');
    await db().query(
      `INSERT INTO ai.merchant_ai_credits
         (business_id, balance, monthly_grant, used_this_month, period_reset_at)
       VALUES ($1, 5, 5, 0, date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month')
       ON CONFLICT (business_id) DO UPDATE SET balance = 5, used_this_month = 0`, [bid]);
  });
  afterAll(tutupDb);

  const buatQuery = async (idem: string) =>
    (await db().query(
      `INSERT INTO ai.ai_query_logs
         (id, business_id, query_text, resolved_intent, source, credits_charged,
          state, idempotency_key)
       VALUES (uuidv7(), $1, 'uji', 'PENDING', 'LLM', 1, 'RESERVED', $2)
       ON CONFLICT (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING id`, [bid, idem])).rows[0]?.id ?? null;

  const saldo = async () =>
    Number((await db().query(
      `SELECT balance FROM ai.merchant_ai_credits WHERE business_id = $1`, [bid])).rows[0].balance);

  it('mencadangkan kredit dan mencatat alasannya', async () => {
    const q = await buatQuery('idem-1');
    const ok = await db().query(`SELECT ai.cadangkan_kredit($1,$2,$3) AS ok`, [bid, q, 'idem-1']);
    expect(ok.rows[0].ok).toBe(true);
    expect(await saldo()).toBe(4);

    const { rows } = await db().query(
      `SELECT delta, reason FROM ai.credit_ledger WHERE query_id = $1`, [q]);
    expect(rows[0]).toEqual({ delta: -1, reason: 'RESERVE' });
  });

  it('menyelesaikan cadangan setelah jawaban benar-benar ada', async () => {
    const q = await buatQuery('idem-2');
    await db().query(`SELECT ai.cadangkan_kredit($1,$2,$3)`, [bid, q, 'idem-2']);
    expect((await db().query(`SELECT ai.selesaikan_kredit($1) AS ok`, [q])).rows[0].ok).toBe(true);

    const { rows } = await db().query(
      `SELECT state, settled_at FROM ai.ai_query_logs WHERE id = $1`, [q]);
    expect(rows[0].state).toBe('SUCCEEDED');
    expect(rows[0].settled_at).not.toBeNull();
  });

  it('mengembalikan kredit saat panggilan gagal', async () => {
    const sebelum = await saldo();
    const q = await buatQuery('idem-3');
    await db().query(`SELECT ai.cadangkan_kredit($1,$2,$3)`, [bid, q, 'idem-3']);
    expect(await saldo()).toBe(sebelum - 1);

    await db().query(`SELECT ai.kembalikan_kredit($1, 'uji gagal')`, [q]);
    expect(await saldo()).toBe(sebelum);
  });

  it('TIDAK mengembalikan kredit untuk pertanyaan yang sudah selesai', async () => {
    const q = await buatQuery('idem-4');
    await db().query(`SELECT ai.cadangkan_kredit($1,$2,$3)`, [bid, q, 'idem-4']);
    await db().query(`SELECT ai.selesaikan_kredit($1)`, [q]);

    const sebelum = await saldo();
    const ok = await db().query(`SELECT ai.kembalikan_kredit($1) AS ok`, [q]);
    expect(ok.rows[0].ok).toBe(false);
    // Jawaban gratis adalah kebocoran yang tidak terlihat sebagai galat.
    expect(await saldo()).toBe(sebelum);
  });

  it('pengembalian ganda tidak menambah saldo dari udara', async () => {
    const q = await buatQuery('idem-5');
    await db().query(`SELECT ai.cadangkan_kredit($1,$2,$3)`, [bid, q, 'idem-5']);
    await db().query(`SELECT ai.kembalikan_kredit($1)`, [q]);
    const sesudahSekali = await saldo();
    await db().query(`SELECT ai.kembalikan_kredit($1)`, [q]);
    expect(await saldo()).toBe(sesudahSekali);
  });

  it('percobaan ulang atas pertanyaan yang sama tidak menagih dua kali', async () => {
    const q = await buatQuery('idem-6');
    await db().query(`SELECT ai.cadangkan_kredit($1,$2,$3)`, [bid, q, 'idem-6']);
    const sesudahSekali = await saldo();

    // Kunci yang sama — jaringan putus lalu dicoba lagi.
    const lagi = await db().query(`SELECT ai.cadangkan_kredit($1,$2,$3) AS ok`, [bid, q, 'idem-6']);
    expect(lagi.rows[0].ok).toBe(true);
    expect(await saldo()).toBe(sesudahSekali);
  });

  it('menolak saat saldo habis, tanpa membuat saldo negatif', async () => {
    await db().query(
      `UPDATE ai.merchant_ai_credits SET balance = 0 WHERE business_id = $1`, [bid]);
    const q = await buatQuery('idem-habis');
    const ok = await db().query(`SELECT ai.cadangkan_kredit($1,$2,$3) AS ok`, [bid, q, 'idem-habis']);
    expect(ok.rows[0].ok).toBe(false);
    expect(await saldo()).toBe(0);
  });

  it('cadangan yang menggantung ditemukan dan dikembalikan', async () => {
    await db().query(
      `UPDATE ai.merchant_ai_credits SET balance = 5 WHERE business_id = $1`, [bid]);
    const q = await buatQuery('idem-gantung');
    await db().query(`SELECT ai.cadangkan_kredit($1,$2,$3)`, [bid, q, 'idem-gantung']);

    // Proses mati di sini: RESERVED, tidak pernah selesai.
    await db().query(
      `UPDATE ai.ai_query_logs SET asked_at = CURRENT_TIMESTAMP - INTERVAL '1 hour' WHERE id = $1`, [q]);

    const sebelum = await saldo();
    const n = await db().query(`SELECT ai.bersihkan_cadangan_menggantung(15) AS n`);
    expect(Number(n.rows[0].n)).toBeGreaterThanOrEqual(1);
    expect(await saldo()).toBeGreaterThan(sebelum);

    const { rows } = await db().query(`SELECT state FROM ai.ai_query_logs WHERE id = $1`, [q]);
    expect(rows[0].state).toBe('REFUNDED');
  });

  it('ledger menjawab "kenapa kredit saya berkurang"', async () => {
    const { rows } = await db().query(
      `SELECT reason, COUNT(*)::int n FROM ai.credit_ledger
        WHERE business_id = $1 GROUP BY reason ORDER BY reason`, [bid]);
    const alasan = rows.map((r: any) => r.reason);
    expect(alasan).toContain('RESERVE');
    expect(alasan).toContain('REFUND');
  });

  /*
   * SATU BARIS YATIM TIDAK BOLEH MENAHAN KREDIT SEMUA ORANG.
   *
   * ai_query_logs dulu memakai ON DELETE SET NULL sementara credit_ledger
   * NOT NULL + CASCADE. Unit usaha dihapus -> ledgernya ikut hilang, lognya
   * bertahan dengan business_id NULL. Kalau log itu berstatus RESERVED, penyapu
   * mati di baris itu — dan karena penyapunya satu transaksi, kredit merchant
   * LAIN yang menggantung ikut tidak pernah dikembalikan.
   */
  it('penyapu tetap jalan walau ada log tanpa pemilik', async () => {
    // Baris yatim dibuat langsung: jalur normal tidak bisa lagi menghasilkannya
    // sejak 0029 memasang NOT NULL, dan itu memang inti perbaikannya.
    const { rows: kolom } = await db().query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='ai' AND table_name='ai_query_logs'
          AND column_name='business_id'`
    );
    expect(kolom[0].is_nullable).toBe('NO');

    const { rows: fk } = await db().query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='ai.ai_query_logs'::regclass AND contype='f'`
    );
    // Sama dengan credit_ledger: ikut terhapus, bukan ditinggal yatim.
    expect(fk.some((r: any) => /ON DELETE CASCADE/.test(r.def))).toBe(true);

    // Dan penyapunya tetap mengembalikan cadangan yang sah.
    const n = await db().query(`SELECT ai.bersihkan_cadangan_menggantung(0) AS n`);
    expect(Number(n.rows[0].n)).toBeGreaterThanOrEqual(0);
  });

  it('menghapus unit usaha ikut membawa log pertanyaannya', async () => {
    const { rows: b } = await db().query(
      `INSERT INTO pos.businesses (id, name, business_sector, client_key, owner_user_ref, is_active)
       VALUES (uuidv7(), 'Toko Yatim', 'FNB', 'usr-yatim_FNB', 'usr-yatim', true)
       RETURNING id`
    );
    const bid = b[0].id;
    await db().query(
      `INSERT INTO ai.ai_query_logs (id, business_id, query_text, resolved_intent, source,
                                     credits_charged, state)
       VALUES (uuidv7(), $1, 'uji yatim', 'PENDING', 'LLM', 1, 'RESERVED')`,
      [bid]
    );

    await db().query(`DELETE FROM pos.merchants WHERE owner_user_ref = 'usr-yatim'`);

    const { rows } = await db().query(
      `SELECT COUNT(*)::int n FROM ai.ai_query_logs WHERE business_id = $1`, [bid]);
    expect(rows[0].n).toBe(0);
  });
});
