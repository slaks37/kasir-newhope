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
import type { Db } from '../../services/shared/db';
import { authenticateBearer } from '../../services/shared/auth';
import { registerSubscriptionAdminRoutes } from './subscriptionAdminRoutes';
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

// Membership is provisioned explicitly with a verified Supabase user subject.
// No demo identities or email-based elevation are created at service startup.
export async function ensureInternalUsers(_db: Db): Promise<void> {}

async function recordAccess(db: Db, who: InternalIdentity, action: string, resource: string,
  merchantId: string | null, justification: string | null, ip: string | null) {
  await db.query(`INSERT INTO internal.internal_access_log
    (id,internal_user_id,internal_role,target_id,action,resource,justification,ip_address)
    VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7)`,
    [who.id,who.role,merchantId,action,resource,justification,ip]);
}

export function registerAdminRoutes(app: express.Express, getDb: () => Promise<Db>, authenticate = authenticateBearer): void {
  function guard(capability: InternalCapability) {
    return async(req:AdminRequest,res:express.Response,next:express.NextFunction)=>{
      try {
        const principal=await authenticate(req);
        if(!principal || principal.subject==='local-development') return res.status(401).json({ok:false,error:'AUTHENTICATION_REQUIRED'});
        const db=await getDb();
        const {rows}=await db.query('SELECT id,email,full_name,role FROM internal.internal_users WHERE sso_subject=$1 AND is_active',[principal.subject]);
        if(!rows[0] || !isInternalRole(rows[0].role)) return res.status(403).json({ok:false,error:'INTERNAL_MEMBERSHIP_REQUIRED'});
        const who:InternalIdentity={id:rows[0].id,email:rows[0].email,fullName:rows[0].full_name,role:rows[0].role};
        const target=String(req.params.merchantId || req.params.tenantId || req.query.merchantId || '') || null;
        if(target && !/^[0-9a-f-]{36}$/i.test(target)) return res.status(400).json({ok:false,error:'INVALID_ID'});
        const reason=String(req.headers['x-justification'] || req.body?.reason || req.query.justification || '').trim() || null;
        if(!hasInternalCapability(who.role,capability)){
          await recordAccess(db,who,'DENIED_'+capability,req.path,target,reason,req.ip || null);
          return res.status(403).json({ok:false,error:'CAPABILITY_DENIED'});
        }
        // Support cannot enumerate sensitive books by omitting merchantId.
        if(who.role==='ROLE_INTERNAL_SUPPORT' && requiresAudit(capability) && (!target || !reason || reason.length<10)) {
          await recordAccess(db,who,'BLOCKED_'+capability,req.path,target,reason,req.ip || null);
          return res.status(400).json({ok:false,error:'MERCHANT_AND_JUSTIFICATION_REQUIRED'});
        }
        if(requiresAudit(capability)) await recordAccess(db,who,capability,req.path,target,reason,req.ip || null);
        req.internal=who;req.environment='PROVIDER_BO';next();
      }catch(err){ next(err); }
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

  // Identitas dan menu hanya tersedia setelah token dan membership diverifikasi.
  app.get('/api/admin/me',guard('VIEW_MERCHANT_HEALTH'),(req:AdminRequest,res)=>{
    res.json({ok:true,user:req.internal,capabilities:internalCapabilities(req.internal!.role),environment:'PROVIDER_BO'});
  });
  app.get('/api/admin/identities',guard('VIEW_ACCESS_AUDIT'),wrap(async(_req,res,db)=>{
    const {rows}=await db.query('SELECT email,full_name,role FROM internal.internal_users WHERE is_active ORDER BY role');
    res.json({ok:true,identities:rows});
  }));
  registerSubscriptionAdminRoutes(app,getDb,guard,wrap);
  app.get('/api/admin/staff-commissions',guard('VIEW_TRANSACTION_LOG'),wrap(async(req,res,db)=>{
    const f=repo.cleanFilter(req.query);
    const {rows}=await db.query(`SELECT * FROM contract.staff_commission_ledger
      WHERE ($1::text IS NULL OR business_sector=$1) AND ($2::uuid IS NULL OR merchant_id=$2)
      AND ($3::text IS NULL OR staff_name ILIKE '%'||$3||'%' OR merchant_name ILIKE '%'||$3||'%')
      ORDER BY created_at DESC LIMIT 200`,[f.sector,f.merchantId,f.search]);
    res.json({ok:true,rows});
  }));

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
           LEFT JOIN internal.tenants t ON t.id::text = COALESCE(l.target_id,l.merchant_id::text)
          ORDER BY l.accessed_at DESC
          LIMIT 200`
      );
      res.json({ ok: true, rows });
    })
  );
}
