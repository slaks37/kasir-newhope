/**
 * Mencari — atau membuat — catatan kepegawaian untuk kasir yang namanya muncul
 * di kiriman sinkron.
 *
 * DIPAKAI DUA JALUR: api/v1/sync/transactions.ts (Vercel) dan
 * services/pos/sync.ts (microservice). Keduanya dulu punya salinan sendiri, dan
 * salinan yang satu sempat menulis peran 'ADMIN' sementara yang lain menulis
 * 'CASHIER' untuk kejadian yang sama.
 *
 * YANG TIDAK DILAKUKAN DI SINI: membuat kredensial.
 *
 * Sebelum 0033, kedua jalur menyisipkan `pin = '----'` untuk setiap nama kasir
 * yang lewat — baris kredensial yang tidak pernah bisa dipakai masuk, dibuat
 * hanya karena kolomnya NOT NULL. Panel admin sudah memperlakukan '----'
 * sebagai "PIN belum dipasang", jadi bahkan pembacanya tahu itu bukan
 * kredensial sungguhan.
 *
 * Sekarang kolom itu tinggal di tabel lain, dan ketiadaan kredensial punya cara
 * mengatakannya sendiri: `auth_user_id IS NULL`. Sinkron tahu SIAPA YANG
 * BEKERJA; ia tidak pernah tahu siapa yang boleh masuk. Kredensial dibuat di
 * layar Kelola Staf, oleh orang yang memang berwenang memberinya.
 */

/** Cukup `pg.PoolClient` maupun klien milik services/shared/db. */
export type PenjalankanKueri = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export type PermintaanStaf = {
  businessId: string;
  /** Identitas staf di perangkat kasir. Nama berubah; ini tidak. */
  employeeCode?: string | null;
  name?: string | null;
  /** Peran dari perangkat. Yang tidak dikenali jatuh ke CASHIER. */
  role?: string | null;
};

const PERAN_DIKENAL = new Set(['ADMIN', 'MANAGER', 'CASHIER']);

/** OWNER adalah sebutan lama untuk ADMIN; masih dikirim perangkat kasir lama. */
export function normalkanPeran(role: string | null | undefined): string {
  const t = String(role ?? '').trim().toUpperCase();
  if (t === 'OWNER') return 'ADMIN';
  return PERAN_DIKENAL.has(t) ? t : 'CASHIER';
}

/**
 * Mengembalikan id staf, atau null bila tidak ada penanda apa pun untuk
 * dicocokkan — nama kosong dan kode kosong bukan orang.
 */
export async function pastikanStaf(
  q: PenjalankanKueri,
  minta: PermintaanStaf
): Promise<string | null> {
  const kode = ringkas(minta.employeeCode, 96);
  const nama = ringkas(minta.name, 100);
  if (!kode && !nama) return null;

  const peran = normalkanPeran(minta.role);

  // Dicocokkan lewat kode dulu, nama hanya sebagai jaring pengaman untuk
  // perangkat lama yang belum pernah mengirim kode.
  const ada = await q.query(
    `SELECT id FROM pos.staff_users
      WHERE business_id = $1
        AND (($2::text IS NOT NULL AND employee_code = $2)
          OR ($3::text IS NOT NULL AND name = $3))
      -- NULLS LAST penting: staf tanpa employee_code menghasilkan NULL, dan
      -- DESC di Postgres menaruh NULL di depan — tanpa ini yang kodenya kosong
      -- menang atas yang kodenya cocok persis.
      ORDER BY (employee_code = $2) DESC NULLS LAST
      LIMIT 1`,
    [minta.businessId, kode, nama]
  );

  if (ada.rows.length) {
    const id = ada.rows[0].id as string;
    // Peran diberikan sekali. Sinkron TIDAK menaikkan atau menurunkan peran
    // orang yang sudah ada: perangkat kasir bukan tempat memutuskan izin, dan
    // satu kiriman dari perangkat yang belum diperbarui tidak boleh
    // mengembalikan manajer menjadi kasir.
    await q.query(
      `INSERT INTO pos.user_roles (staff_user_id, role_code)
       SELECT $1, $2
        WHERE NOT EXISTS (SELECT 1 FROM pos.user_roles WHERE staff_user_id = $1)
       ON CONFLICT DO NOTHING`,
      [id, peran]
    );
    return id;
  }

  const baru = await q.query(
    `INSERT INTO pos.staff_users
       (id, business_id, merchant_id, name, employee_code, status, joined_at)
     SELECT uuidv7(), b.id, b.merchant_id, $2, $3, 'AKTIF', CURRENT_TIMESTAMP
       FROM pos.businesses b WHERE b.id = $1
     ON CONFLICT (business_id, employee_code) WHERE employee_code IS NOT NULL
     DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [minta.businessId, nama || 'Kasir', kode]
  );
  if (!baru.rows.length) return null;

  const id = baru.rows[0].id as string;
  await q.query(
    `INSERT INTO pos.user_roles (staff_user_id, role_code) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [id, peran]
  );
  return id;
}

function ringkas(v: unknown, maks: number): string | null {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, maks) : null;
}
