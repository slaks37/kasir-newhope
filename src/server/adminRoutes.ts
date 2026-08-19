/**
 * API admin panel — semuanya membaca database, tidak ada lagi Map di memori.
 *
 * Dipasang di /api/admin/*. Tiga aturan berlaku untuk setiap route:
 *   1. Pemanggil harus punya identitas INTERNAL (tabel internal_users, bidang
 *      yang terpisah total dari `users` milik merchant).
 *   2. Route menyatakan capability yang dibutuhkannya; role harus memilikinya.
 *   3. Membaca data satu merchant yang teridentifikasi SELALU menulis baris
 *      audit — termasuk saat pembacaan itu ditolak.
 */

import type express from 'express';
import {
  AppEnvironment,
  InternalCapability,
  InternalRole,
  hasInternalCapability,
  internalCapabilities,
  isInternalRole,
  requiresAudit,
  requiresJustification,
  resolveEnvironment,
} from '../lib/rbac/environments';
import type { Db } from './db';
import * as repo from './repo';
import * as plansRepo from './plansRepo';
import {
  issueToken,
  sessionSecretTersedia,
  tokenDariHeader,
  verifyPassword,
  verifyToken,
} from './adminAuth';

interface InternalIdentity {
  id: string;
  email: string;
  fullName: string;
  role: InternalRole;
}


/**
 * Host yang dilihat KLIEN, bukan host tujuan proxy.
 *
 * Gateway wajib mengganti header `host` dengan alamat service supaya HTTP/1.1
 * merutekan dengan benar, sehingga host asli hilang. Tanpa membaca
 * `x-forwarded-host`, resolveEnvironment() hanya melihat "127.0.0.1:3104" dan
 * seluruh pembedaan admin.domainanda.com vs domain merchant lumpuh — konsol
 * internal ikut tersaji di domain merchant.
 *
 * Header ini aman dipercaya HANYA karena gateway membuang kiriman klien dan
 * mengisinya sendiri. Kalau service ini dipasang tanpa gateway di depannya,
 * jangan biarkan x-forwarded-host datang dari luar.
 */
function hostKlien(req: express.Request): string | undefined {
  const diteruskan = req.headers['x-forwarded-host'];
  const nilai = Array.isArray(diteruskan) ? diteruskan[0] : diteruskan;
  // Rantai proxy menambahkan koma; yang pertama adalah klien.
  const pertama = typeof nilai === 'string' ? nilai.split(',')[0].trim() : '';
  return pertama || req.headers.host;
}

interface AdminRequest extends express.Request {
  internal?: InternalIdentity;
  environment?: AppEnvironment | null;
}

const SEED_INTERNAL = [
  { email: 'ops@newhopepos.id', fullName: 'Platform Root', role: 'ROLE_SUPERADMIN' },
  { email: 'growth@newhopepos.id', fullName: 'Growth Analyst', role: 'ROLE_INTERNAL_GROWTH' },
  { email: 'support@newhopepos.id', fullName: 'Support Agent', role: 'ROLE_INTERNAL_SUPPORT' },
] as const;

/**
 * Memastikan ketiga akun internal ada.
 *
 * Ini BUKAN autentikasi. Belum ada SSO di deployment ini, jadi panel
 * mengidentifikasi dirinya lewat header `x-internal-user` berisi email. Cukup
 * untuk pengembangan, dan jelas tidak cukup untuk produksi — lihat catatan
 * SECURITY di bawah.
 */
export async function ensureInternalUsers(db: Db): Promise<void> {
  for (const u of SEED_INTERNAL) {
    await db.query(
      `INSERT INTO internal.internal_users (id, email, full_name, role)
       VALUES (uuidv7(), $1, $2, $3::internal_role_enum)
       ON CONFLICT (email) DO NOTHING`,
      [u.email, u.fullName, u.role]
    );
  }
}

async function recordAccess(
  db: Db,
  who: InternalIdentity,
  action: string,
  resource: string,
  merchantId: string | null,
  justification: string | null,
  ip: string | null
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO internal.internal_access_log
         (id, internal_user_id, internal_role, merchant_id, action, resource,
          justification, ip_address)
       VALUES (uuidv7(), $1::uuid, $2::internal_role_enum, $3::uuid, $4, $5, $6, $7)`,
      [who.id, who.role, merchantId, action, resource, justification, ip]
    );
  } catch (err) {
    // Audit yang gagal tidak boleh menjatuhkan request — tapi juga tidak boleh
    // hilang tanpa jejak.
    console.error('[audit] gagal mencatat akses internal:', (err as Error).message);
  }
}

export function registerAdminRoutes(app: express.Express, getDb: () => Promise<Db>): void {
  /**
   * Identitas datang dari token bertanda tangan di header Authorization, yang
   * hanya bisa diterbitkan /api/admin/login setelah password cocok.
   *
   * Sebelumnya cukup dengan header `x-internal-user: email` — siapa pun yang
   * bisa mengirim HTTP ke server ini bisa mengaku SUPERADMIN. Itu masih bisa
   * ditoleransi selama panel hanya membaca; sejak panel bisa MENGUBAH HARGA,
   * tidak lagi.
   *
   * Baris internal_users tetap dibaca ulang pada SETIAP request meski rolenya
   * sudah ada di dalam token. Token berlaku 8 jam, dan menonaktifkan akun yang
   * disalahgunakan harus berlaku detik itu juga — bukan delapan jam kemudian.
   */
  function guard(capability: InternalCapability) {
    return async (req: AdminRequest, res: express.Response, next: express.NextFunction) => {
      const env = resolveEnvironment(
        hostKlien(req),
        (req.headers['x-env-override'] as string) || undefined
      );

      // Gagal tertutup: host yang tidak dikenal menghasilkan null dan ditolak,
      // bukan ditebak. Menebak salah berarti konsol internal muncul di domain
      // merchant.
      if (env !== 'PROVIDER_BO' && env !== 'MERCHANT_BO') {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }

      let db: Db;
      try {
        db = await getDb();
      } catch {
        return res.status(503).json({ ok: false, error: 'DATABASE_UNAVAILABLE' });
      }

      const klaim = verifyToken(tokenDariHeader(req.headers.authorization));
      if (!klaim) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });

      const { rows } = await db.query(
        `SELECT id, email, full_name, role FROM internal.internal_users
          WHERE id = $1::uuid AND is_active`,
        [klaim.uid]
      );

      // 404, bukan 403: akun yang sudah dinonaktifkan tidak perlu tahu route
      // ini masih ada.
      if (!rows.length) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

      const who: InternalIdentity = {
        id: rows[0].id,
        email: rows[0].email,
        fullName: rows[0].full_name,
        role: rows[0].role,
      };
      if (!isInternalRole(who.role)) {
        return res.status(403).json({ ok: false, error: 'NOT_AN_INTERNAL_IDENTITY' });
      }

      const targetMerchant =
        (req.params.merchantId as string) ||
        (typeof req.query.merchantId === 'string' ? req.query.merchantId : '') ||
        null;
      const justification =
        (req.headers['x-justification'] as string) ||
        (typeof req.query.justification === 'string' ? req.query.justification : '') ||
        null;
      const ip = req.ip || null;

      if (!hasInternalCapability(who.role, capability)) {
        // Penolakan juga dicatat. "Siapa yang MENCOBA membaca pembukuan
        // merchant ini" adalah pertanyaan audit yang sah.
        await recordAccess(db, who, `DENIED_${capability}`, req.path, targetMerchant, justification, ip);
        return res.status(403).json({
          ok: false,
          error: 'CAPABILITY_DENIED',
          detail: `Role ${who.role} tidak memiliki ${capability}.`,
        });
      }

      // Justifikasi hanya wajib ketika satu merchant benar-benar dibidik.
      // Menuntutnya untuk tampilan agregat hanya melatih staf mengetik "cek"
      // di setiap kotak, yang justru merusak nilai auditnya.
      if (targetMerchant && requiresJustification(who.role, capability) && !justification) {
        await recordAccess(db, who, `BLOCKED_${capability}`, req.path, targetMerchant, null, ip);
        return res.status(400).json({
          ok: false,
          error: 'JUSTIFICATION_REQUIRED',
          detail: 'Role support wajib menyertakan alasan sebelum membaca data satu merchant.',
        });
      }

      if (requiresAudit(capability) && targetMerchant) {
        await recordAccess(db, who, capability, req.path, targetMerchant, justification, ip);
      }

      req.internal = who;
      req.environment = env;
      next();
    };
  }

  const wrap =
    (fn: (req: AdminRequest, res: express.Response, db: Db) => Promise<unknown>) =>
    async (req: AdminRequest, res: express.Response) => {
      try {
        await fn(req, res, await getDb());
      } catch (err) {
        // Pesan error database tidak pernah dikirim ke klien: isinya nama
        // tabel, nama kolom, dan kadang potongan data.
        console.error(`[admin] ${req.method} ${req.path}:`, (err as Error).message);
        res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
      }
    };

  /* ---------------------------------------------------------------------- */
  /* SESI                                                                    */
  /* ---------------------------------------------------------------------- */

  // Tanpa guard: panel memakainya untuk mengetahui siapa dirinya dan menu apa
  // yang boleh ditampilkan. Tidak membocorkan data merchant apa pun.
  /**
   * Menukar email + password dengan token sesi.
   *
   * SATU PESAN GALAT UNTUK SEMUA KEGAGALAN. Email tidak dikenal, akun tanpa
   * password, dan password salah dijawab persis sama. Membedakannya mengubah
   * formulir ini menjadi alat untuk mendaftar email mana saja yang merupakan
   * admin — dan daftar itu adalah setengah dari pekerjaan penyerang.
   */
  app.post('/api/admin/login', async (req: AdminRequest, res) => {
    const env = resolveEnvironment(
      hostKlien(req),
      (req.headers['x-env-override'] as string) || undefined
    );
    if (env !== 'PROVIDER_BO' && env !== 'MERCHANT_BO') {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }

    if (!sessionSecretTersedia()) {
      // Dikatakan apa adanya: ini salah konfigurasi server, bukan salah orang
      // yang sedang mencoba masuk.
      return res.status(503).json({
        ok: false,
        error: 'SESSION_SECRET_MISSING',
        detail: 'ADMIN_SESSION_SECRET belum diisi di server. Konsol internal menolak menyala tanpa itu.',
      });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const DITOLAK = { ok: false, error: 'INVALID_CREDENTIALS' };

    if (!email || !password) return res.status(401).json(DITOLAK);

    let db: Db;
    try {
      db = await getDb();
    } catch {
      return res.status(503).json({ ok: false, error: 'DATABASE_UNAVAILABLE' });
    }

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

    // Diverifikasi meski akunnya tidak ada, memakai hash palsu berformat benar.
    // Tanpa itu, email tak dikenal dijawab seketika sementara email yang ada
    // butuh ~100 ms — selisih yang cukup untuk menebak siapa saja adminnya.
    const cocok = await verifyPassword(
      password,
      akun?.password_hash ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA'
    );

    if (!akun || !akun.password_hash || !cocok) {
      if (akun) {
        await db.query(`SELECT internal.catat_login_gagal($1)`, [email]);
        await recordAccess(
          db,
          { id: akun.id, email: akun.email, fullName: akun.full_name, role: akun.role },
          'LOGIN_FAILED',
          '/api/admin/login',
          null,
          null,
          req.ip || null
        );
      } else {
        // internal_access_log.internal_user_id NOT NULL, jadi percobaan
        // terhadap email yang tidak terdaftar tidak bisa masuk ke sana.
        // Dicatat ke log server supaya tetap terlihat, bukan hilang.
        console.warn(`[admin] login ditolak untuk email tak dikenal: ${email} dari ${req.ip}`);
      }
      return res.status(401).json(DITOLAK);
    }

    await db.query(`SELECT internal.catat_login_berhasil($1)`, [email]);
    await recordAccess(
      db,
      { id: akun.id, email: akun.email, fullName: akun.full_name, role: akun.role },
      'LOGIN_SUCCESS',
      '/api/admin/login',
      null,
      null,
      req.ip || null
    );

    res.json({
      ok: true,
      token: issueToken({ sub: akun.email, uid: akun.id, role: akun.role }),
      user: { email: akun.email, fullName: akun.full_name, role: akun.role },
      capabilities: internalCapabilities(akun.role),
      environment: env,
    });
  });

  app.get('/api/admin/me', async (req: AdminRequest, res) => {
    const env = resolveEnvironment(
      hostKlien(req),
      (req.headers['x-env-override'] as string) || undefined
    );
    if (env !== 'PROVIDER_BO' && env !== 'MERCHANT_BO') {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }

    const klaim = verifyToken(tokenDariHeader(req.headers.authorization));
    if (!klaim) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });

    let db: Db;
    try {
      db = await getDb();
    } catch {
      return res.status(503).json({ ok: false, error: 'DATABASE_UNAVAILABLE' });
    }

    const { rows } = await db.query(
      `SELECT id, email, full_name, role FROM internal.internal_users
        WHERE id = $1::uuid AND is_active`,
      [klaim.uid]
    );
    if (!rows.length) return res.status(401).json({ ok: false, error: 'UNKNOWN_IDENTITY' });

    res.json({
      ok: true,
      user: {
        email: rows[0].email,
        fullName: rows[0].full_name,
        role: rows[0].role,
      },
      // Selalu dari server. Panel yang menyusun daftarnya sendiri hanya
      // menyembunyikan menu — ia tidak pernah menjadi batas keamanan.
      capabilities: internalCapabilities(rows[0].role),
      environment: env,
    });
  });

  /* ---------------------------------------------------------------------- */
  /* RINGKASAN PER SEKTOR                                                    */
  /* ---------------------------------------------------------------------- */

  app.get(
    '/api/admin/overview',
    guard('VIEW_SECTOR_ANALYTICS'),
    wrap(async (_req, res, db) => {
      const [sectors, totals, daily] = await Promise.all([
        repo.sectorSummary(db),
        repo.platformTotals(db),
        repo.dailyRevenue(db, 30),
      ]);
      res.json({ ok: true, sectors, totals, daily, sectorLabels: repo.SECTOR_LABEL });
    })
  );

  /* ---------------------------------------------------------------------- */
  /* MERCHANT                                                                */
  /* ---------------------------------------------------------------------- */

  app.get(
    '/api/admin/merchants',
    guard('VIEW_MERCHANT_HEALTH'),
    wrap(async (req, res, db) => {
      res.json({ ok: true, ...(await repo.merchantDirectory(db, req.query as repo.ListFilter)) });
    })
  );

  app.get(
    '/api/admin/merchants/:merchantId',
    guard('VIEW_MERCHANT_DETAIL'),
    wrap(async (req, res, db) => {
      const detail = await repo.merchantDetail(db, req.params.merchantId);
      if (!detail) return res.status(404).json({ ok: false, error: 'MERCHANT_NOT_FOUND' });
      res.json({ ok: true, ...detail });
    })
  );

  /* ---------------------------------------------------------------------- */
  /* TRANSAKSI                                                               */
  /* ---------------------------------------------------------------------- */

  app.get(
    '/api/admin/transactions',
    guard('VIEW_TRANSACTION_LOG'),
    wrap(async (req, res, db) => {
      res.json({ ok: true, ...(await repo.transactionLog(db, req.query as repo.ListFilter)) });
    })
  );

  app.get(
    '/api/admin/transactions/:id',
    guard('VIEW_TRANSACTION_LOG'),
    wrap(async (req, res, db) => {
      const detail = await repo.transactionDetail(db, req.params.id);
      if (!detail) return res.status(404).json({ ok: false, error: 'TRANSACTION_NOT_FOUND' });
      res.json({ ok: true, ...detail });
    })
  );

  /* ---------------------------------------------------------------------- */
  /* PRODUK TERJUAL                                                          */
  /* ---------------------------------------------------------------------- */

  app.get(
    '/api/admin/products',
    guard('VIEW_PRODUCT_SALES'),
    wrap(async (req, res, db) => {
      res.json({ ok: true, ...(await repo.productSales(db, req.query as repo.ListFilter)) });
    })
  );

  // Katalog lengkap — termasuk yang belum pernah terjual.
  app.get(
    '/api/admin/catalog',
    guard('VIEW_PRODUCT_SALES'),
    wrap(async (req, res, db) => {
      res.json({ ok: true, ...(await repo.catalog(db, req.query as repo.ListFilter)) });
    })
  );

  /* ---------------------------------------------------------------------- */
  /* JEJAK AKTIVITAS                                                         */
  /* ---------------------------------------------------------------------- */

  app.get(
    '/api/admin/activity',
    guard('VIEW_ACTIVITY_LOG'),
    wrap(async (req, res, db) => {
      res.json({ ok: true, ...(await repo.activityLog(db, req.query as repo.ListFilter)) });
    })
  );

  app.get(
    '/api/admin/activity/breakdown',
    guard('VIEW_ACTIVITY_LOG'),
    wrap(async (_req, res, db) => {
      res.json({ ok: true, rows: await repo.activityBreakdown(db) });
    })
  );

  /* ---------------------------------------------------------------------- */
  /* AUDIT                                                                   */
  /* ---------------------------------------------------------------------- */

  app.get(
    '/api/admin/access-audit',
    guard('VIEW_ACCESS_AUDIT'),
    wrap(async (_req, res, db) => {
      const { rows } = await db.query(
        `SELECT l.id, l.internal_role, l.action, l.resource, l.justification,
                l.accessed_at, u.email AS internal_email, u.full_name AS internal_name,
                t.name AS merchant_name
           FROM internal.internal_access_log l
           JOIN internal.internal_users u ON u.id = l.internal_user_id
           LEFT JOIN tenants t ON t.id = l.merchant_id
          ORDER BY l.accessed_at DESC
          LIMIT 200`
      );
      res.json({ ok: true, rows });
    })
  );

  /* ---------------------------------------------------------------------- */
  /* PAKET, HARGA, DAN ENTITLEMENT                                           */
  /* ---------------------------------------------------------------------- */

  app.get(
    '/api/admin/plans',
    guard('MANAGE_SUBSCRIPTION'),
    wrap(async (_req, res, db) => {
      const [plans, pemakai] = await Promise.all([plansRepo.daftarPaket(db), plansRepo.pemakaiPaket(db)]);
      res.json({ ok: true, plans, subscriberCounts: pemakai });
    })
  );

  app.get(
    '/api/admin/plans/:planId/history',
    guard('MANAGE_SUBSCRIPTION'),
    wrap(async (req, res, db) => {
      res.json({ ok: true, rows: await plansRepo.riwayatPaket(db, req.params.planId) });
    })
  );

  /**
   * Menyimpan paket. Membuat baru bila kodenya belum ada.
   *
   * Aktornya diambil dari token, BUKAN dari body. Membiarkan pemanggil menyebut
   * dirinya sendiri di kolom `updated_by` membuat riwayat harga bisa
   * ditandatangani atas nama orang lain — dan riwayat yang bisa dipalsukan
   * lebih buruk daripada tidak punya riwayat, karena ia tetap dipercaya.
   */
  app.put(
    '/api/admin/plans/:planId',
    guard('MANAGE_SUBSCRIPTION'),
    wrap(async (req: AdminRequest, res, db) => {
      const masukan = plansRepo.bacaMasukanPaket({ ...req.body, id: req.params.planId });
      try {
        const { plan, kind } = await plansRepo.simpanPaket(db, masukan, req.internal!.email);
        await recordAccess(
          db, req.internal!, `PLAN_${kind}`, `/api/admin/plans/${plan.id}`, null, null, req.ip || null
        );
        res.json({ ok: true, plan, kind });
      } catch (err) {
        if (err instanceof plansRepo.PlanValidationError) {
          return res.status(400).json({ ok: false, error: 'PLAN_INVALID', issues: err.issues });
        }
        throw err;
      }
    })
  );

  app.post(
    '/api/admin/plans/:planId/active',
    guard('MANAGE_SUBSCRIPTION'),
    wrap(async (req: AdminRequest, res, db) => {
      const aktif = req.body?.isActive !== false;
      const plan = await plansRepo.ubahAktifPaket(db, req.params.planId, aktif, req.internal!.email);
      if (!plan) return res.status(404).json({ ok: false, error: 'PLAN_NOT_FOUND' });

      await recordAccess(
        db, req.internal!,
        aktif ? 'PLAN_ACTIVATE' : 'PLAN_DEACTIVATE',
        `/api/admin/plans/${plan.id}`, null, null, req.ip || null
      );
      res.json({ ok: true, plan });
    })
  );
}
