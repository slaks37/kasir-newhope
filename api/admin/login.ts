/**
 * POST /api/admin/login — menukar email + password dengan token sesi.
 *
 * Menggantikan `api.login()` yang membandingkan password dengan string literal
 * di dalam bundle JavaScript. Password itu ada di setiap salinan bundle yang
 * pernah ter-deploy; siapa pun yang membuka /admin bisa membacanya dari sumber
 * halaman. Sejak panel bisa mengubah harga, itu berdampak uang.
 */

type VercelRequest = any;
type VercelResponse = any;

import { internalCapabilities } from '../../src/lib/rbac/environments';
import { issueToken, sessionSecretTersedia, verifyPassword } from '../../src/server/adminAuth';
import { catatAkses, getPool, metodeDilayani } from '../_lib/adminContext';

/**
 * Hash palsu berformat benar, dipakai saat emailnya tidak terdaftar.
 *
 * Tanpa ini, email tak dikenal dijawab seketika sementara email yang ada butuh
 * ~100 ms untuk memeriksa scrypt — selisih yang cukup untuk memetakan siapa
 * saja admin di sistem ini hanya dengan mengukur waktu jawaban.
 */
const HASH_UMPAN =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!metodeDilayani(req, res, ['POST'])) return;

  if (!sessionSecretTersedia()) {
    // Dinyatakan apa adanya: ini salah konfigurasi server, bukan salah orang
    // yang sedang mencoba masuk.
    return res.status(503).json({
      ok: false,
      error: 'SESSION_SECRET_MISSING',
      detail:
        'ADMIN_SESSION_SECRET belum diisi di server (minimal 32 karakter). ' +
        'Konsol internal sengaja menolak menyala tanpa itu.',
    });
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  // SATU pesan untuk semua kegagalan: email tak dikenal, akun tanpa password,
  // dan password salah tidak boleh bisa dibedakan dari luar.
  const DITOLAK = { ok: false, error: 'INVALID_CREDENTIALS' };
  if (!email || !password) return res.status(401).json(DITOLAK);

  const db = getPool();

  try {
    const { rows } = await db.query(
      `SELECT id, email, full_name, role, password_hash, locked_until
         FROM internal.internal_users
        WHERE lower(email) = $1 AND is_active`,
      [email]
    );
    const akun = rows[0];

    if (akun?.locked_until && new Date(akun.locked_until) > new Date()) {
      return res.status(429).json({
        ok: false,
        error: 'TOO_MANY_ATTEMPTS',
        detail: 'Terlalu banyak percobaan gagal. Coba lagi beberapa menit lagi.',
      });
    }

    const cocok = await verifyPassword(password, akun?.password_hash ?? HASH_UMPAN);

    if (!akun || !akun.password_hash || !cocok) {
      if (akun) {
        await db.query(`SELECT internal.catat_login_gagal($1)`, [email]);
        await catatAkses(
          { id: akun.id, email: akun.email, fullName: akun.full_name, role: akun.role },
          'LOGIN_FAILED',
          '/api/admin/login',
          req
        );
      } else {
        // internal_access_log.internal_user_id NOT NULL, jadi percobaan
        // terhadap email tak terdaftar tidak bisa masuk ke sana.
        console.warn(`[admin] login ditolak untuk email tak dikenal: ${email}`);
      }
      return res.status(401).json(DITOLAK);
    }

    await db.query(`SELECT internal.catat_login_berhasil($1)`, [email]);
    await catatAkses(
      { id: akun.id, email: akun.email, fullName: akun.full_name, role: akun.role },
      'LOGIN_SUCCESS',
      '/api/admin/login',
      req
    );

    return res.status(200).json({
      ok: true,
      token: issueToken({ sub: akun.email, uid: akun.id, role: akun.role }),
      user: { email: akun.email, fullName: akun.full_name, role: akun.role },
      capabilities: internalCapabilities(akun.role),
    });
  } catch (err: any) {
    console.error('[admin] login gagal:', err?.message);
    return res.status(503).json({ ok: false, error: 'DATABASE_UNAVAILABLE' });
  }
}
