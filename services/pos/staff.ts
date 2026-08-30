/**
 * Otorisasi staf — diverifikasi server, bukan browser.
 *
 * KENAPA MODUL INI ADA.
 *
 * Void dan refund dulu dijaga modal PIN di `RecentTransactionsModal.tsx`. Itu
 * gerbang sisi klien: server menerima `cashierRole` dari body dan memakainya
 * hanya sebagai label audit. Memanggil endpointnya langsung sudah cukup untuk
 * melewatinya:
 *
 *   POST /api/v1/sync/transactions { cashierRole:'CASHIER', paymentStatus:'CANCELLED' }
 *   -> 200 voided=1
 *
 * MEMERIKSA PERAN DARI BODY TIDAK MEMPERBAIKI APA PUN. Satu merchant memakai
 * satu akun Supabase, dan seluruh staf berbagi terminal yang sudah login dengan
 * akun itu. Dari sisi server, kasir dan manajer adalah principal yang sama —
 * peran apa pun yang dikirim klien adalah klaim klien tentang dirinya sendiri.
 *
 * Batas yang nyata di terminal bersama hanyalah RAHASIA YANG TIDAK DIKETAHUI
 * KASIR: PIN manajer. Karena itu yang diverifikasi di sini adalah PIN, dan
 * perannya dibaca dari `internal.memberships` — catatan server, bukan kiriman.
 *
 * FORMAT PIN sama persis dengan sisi klien (`src/lib/auth/pinSecurity.ts`):
 *
 *   sha256$<salt>$<sha256(pin + ':' + salt)>
 *
 * Verifikasinya di sini memakai `node:crypto`, bukan Web Crypto, karena ini
 * berjalan di Node. Hasilnya identik — yang penting rumusnya sama, bukan
 * pustakanya.
 */

import crypto from 'node:crypto';
import type { Db } from '../shared/db';

/** Peran yang boleh mengotorisasi pembatalan transaksi. */
const PERAN_BOLEH_VOID = new Set(['OWNER', 'ADMIN', 'MANAGER']);

export class VoidAuthError extends Error {
  constructor(
    readonly kode: 'AUTHORIZATION_REQUIRED' | 'STAFF_NOT_FOUND' | 'ROLE_FORBIDDEN' | 'INVALID_PIN',
    pesan: string
  ) {
    super(pesan);
  }
}

/**
 * Membandingkan PIN dengan hash tersimpan.
 *
 * `timingSafeEqual` dipakai agar lama-tidaknya pemeriksaan tidak membocorkan
 * seberapa banyak karakter yang sudah benar. PIN hanya empat sampai enam angka;
 * tanpa ini, menebaknya satu digit demi satu digit menjadi jauh lebih murah.
 */
function pinCocok(pin: string, tersimpan: string | null): boolean {
  if (!tersimpan) return false;
  const bagian = tersimpan.split('$');
  if (bagian.length !== 3 || bagian[0] !== 'sha256') return false;
  const [, salt, harapan] = bagian;

  const dihitung = crypto.createHash('sha256').update(`${pin}:${salt}`).digest('hex');
  const a = Buffer.from(dihitung, 'utf8');
  const b = Buffer.from(harapan, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Bukti terikat-transaksi: sha256(`<pin_hash>:<clientTxnId>`). */
function buktiCocok(bukti: string, pinHash: string | null, clientTxnId: string): boolean {
  if (!pinHash || !clientTxnId) return false;
  const harapan = crypto.createHash('sha256').update(`${pinHash}:${clientTxnId}`).digest('hex');
  const a = Buffer.from(bukti, 'utf8');
  const b = Buffer.from(harapan, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface OtorisasiVoid {
  /** Id staf sisi perangkat yang mengotorisasi — BUKAN kasir yang menjual. */
  staffRef?: string | null;
  /** PIN apa adanya. Hanya dipakai jalur langsung (uji, integrasi server-ke-server). */
  pin?: string | null;
  /**
   * Bukti otorisasi terikat-transaksi: `sha256(<pin_hash>:<clientTxnId>)`.
   *
   * INI JALUR YANG DIPAKAI APLIKASI KASIR, dan alasannya adalah offline.
   *
   * Void bisa terjadi saat internet mati, lalu menunggu di antrian
   * `localStorage` sampai tersambung. Menyimpan PIN apa adanya di antrian itu
   * berarti PIN manajer tergeletak di penyimpanan browser — bisa dibaca siapa
   * pun yang membuka konsol peramban di terminal itu, dan bisa dipakai di
   * terminal lain.
   *
   * Bukti ini menghindarinya: ia diturunkan dari hash yang memang sudah ada di
   * perangkat, dan DIIKAT ke satu `clientTxnId`. Yang mencurinya dari antrian
   * hanya bisa membatalkan transaksi yang memang sudah dibatalkan.
   */
  proof?: string | null;
  /** Transaksi yang diotorisasi. Mengikat bukti agar tidak bisa dipakai ulang. */
  clientTxnId?: string | null;
}

/**
 * Memastikan pembatalan transaksi benar-benar diotorisasi.
 *
 * Melempar `VoidAuthError` bila tidak. Pemanggil menerjemahkannya menjadi 403
 * dengan kode yang bisa ditampilkan ke kasir — pesan "otorisasi ditolak" yang
 * tidak menyebut sebabnya hanya membuat kasir mencoba lagi dengan PIN yang sama.
 *
 * Mengembalikan nama dan peran pengotorisasi supaya jejak audit menyebut SIAPA
 * yang menyetujui, bukan sekadar bahwa ada yang menyetujui.
 */
export async function pastikanVoidDiotorisasi(
  db: Db,
  tenantId: string,
  auth: OtorisasiVoid
): Promise<{ nama: string; peran: string }> {
  const staffRef = (auth.staffRef ?? '').trim();
  const pin = (auth.pin ?? '').trim();
  const proof = (auth.proof ?? '').trim();

  if (!staffRef || (!pin && !proof)) {
    throw new VoidAuthError(
      'AUTHORIZATION_REQUIRED',
      'Pembatalan transaksi memerlukan otorisasi manajer.'
    );
  }

  const { rows } = await db.query(
    `SELECT ms.role, ms.pin_hash,
            COALESCE(ms.display_name, u.full_name, 'Staf') AS nama
       FROM internal.memberships ms
       LEFT JOIN internal.users u ON u.id = ms.user_id
      WHERE ms.tenant_id = $1 AND ms.external_ref = $2 AND ms.is_active
      LIMIT 1`,
    [tenantId, staffRef]
  );

  if (!rows.length) {
    throw new VoidAuthError(
      'STAFF_NOT_FOUND',
      'Staf pengotorisasi tidak terdaftar. Daftarkan staf lebih dulu dari menu Pengaturan.'
    );
  }

  const { role, pin_hash, nama } = rows[0] as { role: string; pin_hash: string | null; nama: string };

  /*
   * PERAN DIPERIKSA SEBELUM PIN, dan itu disengaja.
   *
   * PIN kasir yang benar tidak boleh dianggap otorisasi hanya karena PIN-nya
   * cocok. Kalau urutannya dibalik, seorang kasir bisa memakai PIN-nya sendiri
   * dan baru ditolak setelahnya — yang berarti sistem sempat memverifikasi
   * rahasia untuk keputusan yang sudah pasti ditolak.
   */
  if (!PERAN_BOLEH_VOID.has(String(role).toUpperCase())) {
    throw new VoidAuthError(
      'ROLE_FORBIDDEN',
      `Peran ${role} tidak berwenang membatalkan transaksi. Minta manajer atau pemilik.`
    );
  }

  /*
   * Dua jalur, satu rahasia.
   *
   * `proof` diturunkan dari pin_hash yang sama dengan yang tersimpan di sini,
   * jadi memilikinya setara dengan mengetahui PIN — bedanya, bukti itu terikat
   * ke satu transaksi dan tidak bisa diketik ulang di terminal lain.
   */
  const sah = proof
    ? buktiCocok(proof, pin_hash, auth.clientTxnId ?? '')
    : pinCocok(pin, pin_hash);

  if (!sah) {
    throw new VoidAuthError('INVALID_PIN', 'Otorisasi tidak sah.');
  }

  return { nama, peran: String(role).toUpperCase() };
}

export interface StafMasuk {
  ref: string;
  nama: string;
  peran: string;
  /** Sudah ter-hash di klien; PIN apa adanya tidak pernah menyeberang. */
  pinHash?: string | null;
  aktif?: boolean;
}

/**
 * Mendaftarkan staf merchant beserta perannya.
 *
 * Dipanggil dari `POST /api/v1/sync/staff`, dan yang memanggilnya harus
 * principal pemilik akun — itulah jangkar kepercayaannya. Kasir tidak bisa
 * menaikkan perannya sendiri karena ia tidak bisa mengubah catatan ini tanpa
 * mengubahnya lewat jalur yang sama, dan jalur itu mencatat siapa yang mengubah.
 *
 * PIN diterima SUDAH TER-HASH dari klien. PIN apa adanya tidak pernah melewati
 * jaringan maupun tersimpan di server — yang tersimpan hanya hash bersalt yang
 * sama dengan yang dipakai layar kunci terminal.
 */
export async function daftarkanStaf(
  db: Db,
  tenantId: string,
  merchantId: string,
  daftar: StafMasuk[]
): Promise<{ tersimpan: number; dinonaktifkan: number }> {
  let tersimpan = 0;
  const refTerkirim: string[] = [];

  for (const s of daftar) {
    const ref = String(s.ref ?? '').trim().slice(0, 96);
    if (!ref) continue;
    refTerkirim.push(ref);

    // Satu baris internal.users per staf, alamat sintetis yang sama bentuknya
    // dengan resolveCashier di sync.ts supaya tidak lahir dua identitas.
    const slug = ref.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'staf';
    const email = `${slug.slice(0, 64)}@${tenantId}.pos.local`;
    const u = await db.query(
      `INSERT INTO internal.users (id, email, full_name)
       VALUES (uuidv7(), $1, $2)
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
      [email.slice(0, 160), String(s.nama ?? 'Staf').slice(0, 100)]
    );

    /*
     * pin_hash hanya ditimpa kalau klien benar-benar mengirimnya.
     * `COALESCE(EXCLUDED.pin_hash, memberships.pin_hash)` menjaga PIN yang sudah
     * ada tetap berlaku saat klien hanya memperbarui nama atau peran — tanpa itu,
     * setiap sinkronisasi staf akan mencabut kemampuan otorisasi semua orang.
     */
    /*
     * scope_type = 'MERCHANT' dan merchant_id WAJIB diisi.
     *
     * `chk_membership_scope_consistency` (migrasi 0026) menuntut ketiganya
     * konsisten: TENANT tanpa merchant, MERCHANT dengan merchant tapi tanpa
     * outlet, OUTLET dengan keduanya. Staf kasir adalah milik UNIT USAHA —
     * seorang barista di kafe bukan otomatis staf laundry milik pemilik yang
     * sama — jadi MERCHANT adalah cakupan yang benar.
     */
    await db.query(
      `INSERT INTO internal.memberships
         (id, user_id, tenant_id, merchant_id, scope_type, role,
          external_ref, display_name, pin_hash, is_active)
       VALUES (uuidv7(), $1, $2, $3, 'MERCHANT', $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, external_ref) WHERE external_ref IS NOT NULL
       DO UPDATE SET
         role         = EXCLUDED.role,
         merchant_id  = EXCLUDED.merchant_id,
         display_name = EXCLUDED.display_name,
         pin_hash     = COALESCE(EXCLUDED.pin_hash, internal.memberships.pin_hash),
         is_active    = EXCLUDED.is_active,
         updated_at   = CURRENT_TIMESTAMP`,
      [
        u.rows[0].id,
        tenantId,
        merchantId,
        String(s.peran ?? 'CASHIER').toUpperCase().slice(0, 32),
        ref,
        String(s.nama ?? 'Staf').slice(0, 100),
        s.pinHash ? String(s.pinHash).slice(0, 160) : null,
        s.aktif !== false,
      ]
    );
    tersimpan++;
  }

  /*
   * Staf yang HILANG dari kiriman dinonaktifkan, tidak dihapus.
   *
   * Menghapusnya akan memutus `cashier_user_id` pada seluruh transaksi yang
   * pernah ia layani. Staf yang keluar tetap harus terbaca di laporan bulan lalu.
   */
  let dinonaktifkan = 0;
  if (refTerkirim.length) {
    const r = await db.query(
      `UPDATE internal.memberships
          SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1
          AND external_ref IS NOT NULL
          AND NOT (external_ref = ANY($2::text[]))
          AND is_active
        RETURNING id`,
      [tenantId, refTerkirim]
    );
    dinonaktifkan = r.rows.length;
  }

  return { tersimpan, dinonaktifkan };
}
