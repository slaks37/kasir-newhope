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

/**
 * Konsol penyedia hanya hidup di lingkungan penyedia.
 *
 * MERCHANT_BO sengaja TIDAK diterima. environments.ts menyatakan invariannya
 * dengan jelas — "internal staff never touch a merchant environment" — tapi
 * pemeriksaan sebelumnya meloloskan keduanya, sehingga API konsol internal ikut
 * terbuka di domain back-office merchant.
 *
 * resolveEnvironment() memetakan localhost ke MERCHANT_BO, jadi pengembangan
 * lokal tetap perlu jalan. Kelonggaran itu diikat ke AUTH_ALLOW_LOCAL_DEVELOPMENT
 * — flag yang SUDAH dipakai services/shared/auth.ts untuk tujuan yang sama —
 * bukan kelonggaran baru yang berdiri sendiri. Tanpa flag itu, jawabannya tidak.
 */
function isProviderEnvironment(env: AppEnvironment | null): boolean {
  if (env === 'PROVIDER_BO') return true;
  return env === 'MERCHANT_BO' && process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT === '1';
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
   * SECURITY — CELAH YANG MASIH TERBUKA.
   *
   * Identitas diambil dari header `x-internal-user`, tanpa password dan tanpa
   * token. Siapa pun yang bisa mengirim HTTP ke service ini, dengan email staf
   * internal yang benar, dianggap staf internal.
   *
   * Yang SUDAH dipersempit: route hanya hidup di PROVIDER_BO (lihat
   * isProviderEnvironment), dan /api/admin/identities tidak lagi membocorkan
   * daftar email yang dibutuhkan untuk menebak nilai header itu.
   *
   * Yang BELUM: header itu sendiri. Sebelum admin.domainanda.com menyala ia
   * WAJIB diganti dengan principal terverifikasi gateway (`x-auth-sub`) yang
   * dicocokkan ke internal_users.sso_subject — kolomnya sudah disiapkan. Selama
   * itu belum ada, gateway juga harus membuang `x-internal-user` dan
   * `x-env-override` dari kiriman klien. Jangan deploy tanpa keduanya.
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
      if (!isProviderEnvironment(env)) {
        return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      }

      let db: Db;
      try {
        db = await getDb();
      } catch {
        return res.status(503).json({ ok: false, error: 'DATABASE_UNAVAILABLE' });
      }

      const email = String(req.headers['x-internal-user'] || '').trim().toLowerCase();
      const { rows } = await db.query(
        `SELECT id, email, full_name, role FROM internal.internal_users
          WHERE lower(email) = $1 AND is_active`,
        [email]
      );

      // 404, bukan 401: pemanggil tanpa identitas tidak perlu tahu route ini ada.
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
  app.get('/api/admin/me', async (req: AdminRequest, res) => {
    const env = resolveEnvironment(
      hostKlien(req),
      (req.headers['x-env-override'] as string) || undefined
    );
    if (!isProviderEnvironment(env)) {
      return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    }

    let db: Db;
    try {
      db = await getDb();
    } catch {
      return res.status(503).json({ ok: false, error: 'DATABASE_UNAVAILABLE' });
    }

    const email = String(req.headers['x-internal-user'] || '').trim().toLowerCase();
    const { rows } = await db.query(
      `SELECT id, email, full_name, role FROM internal.internal_users
        WHERE lower(email) = $1 AND is_active`,
      [email]
    );
    if (!rows.length) return res.status(401).json({ ok: false, error: 'UNKNOWN_IDENTITY' });

    res.json({
      ok: true,
      user: {
        email: rows[0].email,
        fullName: rows[0].full_name,
        role: rows[0].role,
      },
      capabilities: internalCapabilities(rows[0].role),
      environment: env,
    });
  });

  /**
   * Daftar akun internal beserta rolenya.
   *
   * Dulu tanpa guard sama sekali, untuk mengisi pemilih identitas di layar
   * masuk. Justru itu masalahnya: layar masuk yang belum terautentikasi
   * membocorkan email dan role setiap staf internal — persis daftar target
   * yang dibutuhkan penyerang untuk menyalahgunakan header `x-internal-user`.
   *
   * Sekarang tertutup di balik VIEW_ACCESS_AUDIT (hanya SUPERADMIN). Pemilih
   * identitas pra-login sengaja dihilangkan; siapa dirinya diketikkan sendiri
   * oleh staf, tidak disodorkan sistem.
   */
  app.get(
    '/api/admin/identities',
    guard('VIEW_ACCESS_AUDIT'),
    wrap(async (_req, res, db) => {
      const { rows } = await db.query(
        `SELECT email, full_name, role FROM internal.internal_users WHERE is_active ORDER BY role`
      );
      res.json({ ok: true, identities: rows });
    })
  );

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
}
