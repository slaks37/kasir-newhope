/**
 * Sinkron mencatat KEPEGAWAIAN, bukan kredensial.
 *
 * Sebelum 0033, kedua jalur sinkron menyisipkan `pin = '----'` untuk setiap nama
 * kasir yang lewat: baris kredensial yang tidak pernah bisa dipakai masuk,
 * dibuat semata karena kolomnya NOT NULL. Panel admin bahkan sudah
 * memperlakukan '----' sebagai "PIN belum dipasang" — pembacanya pun tahu itu
 * bukan kredensial sungguhan.
 *
 * Yang dijaga berkas ini: perangkat kasir tidak bisa melahirkan akun yang bisa
 * masuk ke server. Memberi login adalah tindakan sadar seseorang yang berwenang,
 * bukan efek samping dari sebuah struk yang tersinkronisasi.
 */

import { describe, it, expect, afterAll } from 'vitest';
import sinkron from '../api/v1/sync/transactions';
import { ADA_DB, db, tutupDb, resTiruan, bersihkanPemilik, headerToko } from './helper-db';
import sesi from '../api/v1/auth/session';

const d = describe.skipIf(!ADA_DB);

// Endpoint toko menolak permintaan tanpa token. Diisi setelah toko ujinya ada.
let HDR: Record<string, string> = {};

d('sinkron dan identitas staf', () => {
  const KEY = 'usr-stafuji_FNB';

  // Tokonya belum ada saat tes dimulai — dibuat lewat endpoint sesi, yang
  // memang merangkap pendaftaran. Ini sekaligus memastikan alur "terminal baru
  // pertama kali menyala" benar-benar bekerja.
  const siapkanToko = async () => {
    const res = resTiruan();
    await sesi({ method: 'POST', headers: {}, body: {
      businessId: KEY, ownerRef: KEY.split('_')[0],
      storeName: 'Warung Staf', sector: 'FNB',
    } } as any, res as any);
    const { rows } = await db().query(
      'SELECT id FROM pos.businesses WHERE client_key = $1', [KEY]);
    HDR = headerToko(rows[0].id, KEY);
  };

  afterAll(async () => {
    if (ADA_DB) await bersihkanPemilik(KEY);
    await tutupDb();
  });

  const kirim = async (nama: string, tandai: string) => {
    const res = resTiruan();
    await sinkron(
      { method: 'POST', headers: HDR,
        body: {
          businessId: KEY,
          storeName: 'Warung Staf',
          sector: 'FNB',
          idempotencyKey: `k-${tandai}`,
          transactions: [
            {
              clientTxnId: `t-${tandai}`,
              cashierName: nama,
              invoiceNumber: `INV-${tandai}`,
              subtotal: 10000,
              totalAmount: 10000,
              paymentMethod: 'CASH',
              paymentStatus: 'COMPLETED',
              items: [],
            },
          ],
        },
      } as any,
      res as any
    );
    return res;
  };

  it('membuat staf lengkap dengan peran, tanpa satu pun kredensial', async () => {
    await bersihkanPemilik(KEY);
    await siapkanToko();
    const res = await kirim('Kasir Uji', 'satu');
    expect(res._status).toBe(200);

    const { rows } = await db().query(
      `SELECT s.name, s.status, s.auth_user_id,
              (s.merchant_id = b.merchant_id) AS merchant_cocok,
              (SELECT array_agg(r.role_code) FROM pos.user_roles r
                WHERE r.staff_user_id = s.id) AS roles
         FROM pos.staff_users s
         JOIN pos.businesses b ON b.id = s.business_id
        WHERE b.client_key = $1`,
      [KEY]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('AKTIF');
    expect(rows[0].roles).toEqual(['ADMIN']);
    // Pemberi kerjanya ikut terisi, dan tidak berbeda dari unit usahanya.
    expect(rows[0].merchant_cocok).toBe(true);
    // Ini intinya: tidak ada kredensial yang lahir dari sebuah struk.
    expect(rows[0].auth_user_id).toBeNull();

    const kredensial = await db().query(
      `SELECT COUNT(*)::int n FROM pos.auth_users a
         JOIN pos.businesses b ON b.id = a.business_id
        WHERE b.client_key = $1`,
      [KEY]
    );
    expect(kredensial.rows[0].n).toBe(0);
  });

  it('kiriman berikutnya memakai staf yang sama, tidak melahirkan yang baru', async () => {
    // Kasir yang sama dikenali lewat employee_code, bukan nama — jadi nama yang
    // berubah di perangkat tidak memecah satu orang menjadi dua.
    await kirim('Kasir Uji Ganti Nama', 'dua');

    const { rows } = await db().query(
      `SELECT COUNT(*)::int n FROM pos.staff_users s
         JOIN pos.businesses b ON b.id = s.business_id
        WHERE b.client_key = $1`,
      [KEY]
    );
    expect(rows[0].n).toBe(1);
  });

  it('struk lama tetap menunjuk kasirnya lewat contract.transaction_log', async () => {
    const { rows } = await db().query(
      `SELECT t.cashier_name, COUNT(*)::int n
         FROM contract.transaction_log t
         JOIN pos.businesses b ON b.id = t.business_id
        WHERE b.client_key = $1
        GROUP BY 1`,
      [KEY]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].n).toBe(2);
    expect(rows[0].cashier_name).toBeTruthy();
  });
});
