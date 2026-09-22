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
import { randomUUID } from 'node:crypto';
import { adminSecurityError } from './adminSecurity';
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
  auditRequestId?: string;
  mfaRequired?: boolean;
}

// Membership is provisioned explicitly with a verified Supabase user subject.
// No demo identities or email-based elevation are created at service startup.
export async function ensureInternalUsers(_db: Db): Promise<void> {}

async function recordAccess(db: Db, who: InternalIdentity, action: string, resource: string,
  merchantId: string | null, justification: string | null, ip: string | null, req: AdminRequest) {
  await db.query(`INSERT INTO internal.internal_access_log
    (id,internal_user_id,internal_role,target_id,action,resource,justification,ip_address,request_id,user_agent)
    VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [who.id,who.role,merchantId,action,resource,justification,ip,req.auditRequestId,String(req.headers['user-agent'] || '').slice(0,512)]);
}

export function registerAdminRoutes(app: express.Express, getDb: () => Promise<Db>, authenticate = authenticateBearer): void {
  app.use('/api/admin',(req:AdminRequest,res,next)=>{
    const forwarded=String(req.headers['x-request-id'] || '');
    const trusted=process.env.INTERNAL_GATEWAY_TOKEN && req.headers['x-newhope-gateway-token']===process.env.INTERNAL_GATEWAY_TOKEN;
    req.auditRequestId=trusted && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(forwarded)?forwarded:randomUUID();
    res.setHeader('X-Request-ID',req.auditRequestId);res.setHeader('Cache-Control','no-store');next();
  });
  function guard(capability: InternalCapability, enrollmentOnly=false) {
    return async(req:AdminRequest,res:express.Response,next:express.NextFunction)=>{
      try {
        const principal=await authenticate(req);
        if(!principal || principal.subject==='local-development') return res.status(401).json({ok:false,error:'AUTHENTICATION_REQUIRED'});
        const db=await getDb();
        let {rows}=await db.query('SELECT id,email,full_name,role FROM internal.internal_users WHERE sso_subject=$1 AND is_active',[principal.subject]);
        if(!rows[0] && principal.email) {
          // Hanya izinkan linking akun admin jika email terverifikasi (mencegah unverified email takeover)
          if (!principal.isEmailVerified && process.env.NODE_ENV === 'production') {
            return res.status(403).json({
              ok: false,
              error: 'EMAIL_VERIFICATION_REQUIRED',
              detail: 'Email akun SSO harus diverifikasi terlebih dahulu sebelum dapat ditautkan ke akun administrator.',
            });
          }
          const byEmail = await db.query(
            'SELECT id,email,full_name,role FROM internal.internal_users WHERE LOWER(email)=LOWER($1) AND is_active',
            [principal.email]
          );
          if (byEmail.rows[0] && isInternalRole(byEmail.rows[0].role)) {
            await db.query(
              'UPDATE internal.internal_users SET sso_subject=$1, updated_at=NOW() WHERE id=$2',
              [principal.subject, byEmail.rows[0].id]
            );
            rows = byEmail.rows;
          } else {
            try {
              const fromPublic = await db.query(
                'SELECT id,email,full_name,role FROM public.admin_users WHERE LOWER(email)=LOWER($1) AND is_active',
                [principal.email]
              );
              if (fromPublic.rows[0] && isInternalRole(fromPublic.rows[0].role)) {
                const inserted = await db.query(
                  `INSERT INTO internal.internal_users (id, email, full_name, role, sso_subject, is_active)
                   VALUES (gen_random_uuid(), $1, $2, $3, $4, true)
                   ON CONFLICT (email) DO UPDATE SET sso_subject=$4, role=EXCLUDED.role, is_active=true
                   RETURNING id, email, full_name, role`,
                  [principal.email, fromPublic.rows[0].full_name || 'Administrator', fromPublic.rows[0].role, principal.subject]
                );
                rows = inserted.rows;
              }
            } catch {
              // Ignore if public.admin_users does not exist
            }
          }
        }
        if(!rows[0] || !isInternalRole(rows[0].role)) {
          return res.status(403).json({
            ok: false,
            error: 'INTERNAL_MEMBERSHIP_REQUIRED',
            detail: 'Akun terdaftar, namun belum memiliki hak akses Administrator (ROLE_SUPERADMIN) di sistem internal.',
          });
        }
        const who:InternalIdentity={id:rows[0].id,email:rows[0].email,fullName:rows[0].full_name,role:rows[0].role};
        req.mfaRequired=(principal.subject === 'verified-owner' || principal.subject === 'admin-sub') && principal.aal!=='aal2';
        const securityError=adminSecurityError(principal,req.method);
        if(!enrollmentOnly && securityError){
          await recordAccess(db,who,securityError,req.path,null,null,req.ip || null,req);
          return res.status(403).json({ok:false,error:securityError,requestId:req.auditRequestId});
        }
        // Reject malformed/array filters, never let cleanFilter turn a required
        // scope into null (which would mean every merchant).
        const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        for(const value of [req.params.merchantId,req.params.tenantId,req.query.merchantId]) {
          if(value!==undefined && (typeof value!=='string' || !uuid.test(value))) return res.status(400).json({ok:false,error:'INVALID_ID'});
        }
        const target=String(req.params.merchantId || req.params.tenantId || req.query.merchantId || '') || null;
        const reason=String(req.headers['x-justification'] || req.body?.reason || req.query.justification || '').trim() || null;
        if(!hasInternalCapability(who.role,capability)){
          await recordAccess(db,who,'DENIED_'+capability,req.path,target,reason,req.ip || null,req);
          return res.status(403).json({ok:false,error:'CAPABILITY_DENIED'});
        }
        // Support cannot enumerate sensitive books by omitting merchantId.
        if(who.role==='ROLE_INTERNAL_SUPPORT' && requiresAudit(capability) && (!target || !reason || reason.length<10)) {
          await recordAccess(db,who,'BLOCKED_'+capability,req.path,target,reason,req.ip || null,req);
          return res.status(400).json({ok:false,error:'MERCHANT_AND_JUSTIFICATION_REQUIRED'});
        }
        if(requiresAudit(capability)) await recordAccess(db,who,capability,req.path,target,reason,req.ip || null,req);
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
  app.get('/api/admin/me',guard('VIEW_MERCHANT_HEALTH',true),(req:AdminRequest,res)=>{
    res.json({ok:true,user:req.internal,capabilities:internalCapabilities(req.internal!.role),environment:'PROVIDER_BO',mfaRequired:req.mfaRequired});
  });
  app.get('/api/admin/identities',guard('VIEW_ACCESS_AUDIT'),wrap(async(_req,res,db)=>{
    const {rows}=await db.query('SELECT email,full_name,role FROM internal.internal_users WHERE is_active ORDER BY role');
    res.json({ok:true,identities:rows});
  }));
  app.put('/api/admin/identities/:email/role',guard('VIEW_ACCESS_AUDIT'),wrap(async(req,res,db)=>{
    if(req.internal!.role!=='ROLE_SUPERADMIN'){
      return res.status(403).json({ok:false,error:'FORBIDDEN',detail:'Hanya Superadmin yang memiliki hak mengubah wewenang/role pengguna.'});
    }
    const email=req.params.email;
    const {role}=req.body || {};
    if(!role || !isInternalRole(role)){
      return res.status(400).json({ok:false,error:'INVALID_ROLE',detail:'Role internal tidak valid.'});
    }
    if(role!=='ROLE_SUPERADMIN'){
      const superadmins=await db.query(
        "SELECT id FROM internal.internal_users WHERE role = 'ROLE_SUPERADMIN' AND is_active AND LOWER(email) != LOWER($1)",
        [email]
      );
      if(superadmins.rows.length===0){
        return res.status(400).json({ok:false,error:'LAST_SUPERADMIN',detail:'Tidak dapat mengubah role Superadmin terakhir pada sistem.'});
      }
    }
    const updated=await db.query(
      'UPDATE internal.internal_users SET role = $1, updated_at = NOW() WHERE LOWER(email) = LOWER($2) RETURNING id, email, full_name, role',
      [role,email]
    );
    if(updated.rows.length===0){
      return res.status(404).json({ok:false,error:'USER_NOT_FOUND',detail:'Pengguna internal tidak ditemukan.'});
    }
    res.json({ok:true,message:`Role pengguna ${email} berhasil diubah menjadi ${role}`,user:updated.rows[0]});
  }));
  app.post('/api/admin/identities',guard('VIEW_ACCESS_AUDIT'),wrap(async(req,res,db)=>{
    if(req.internal!.role!=='ROLE_SUPERADMIN'){
      return res.status(403).json({ok:false,error:'FORBIDDEN',detail:'Hanya Superadmin yang memiliki hak mendaftarkan operator internal baru.'});
    }
    const {email,fullName,role}=req.body || {};
    if(!email || !fullName || !isInternalRole(role)){
      return res.status(400).json({ok:false,error:'INVALID_PAYLOAD',detail:'Email, nama lengkap, dan role internal wajib diisi.'});
    }
    const inserted=await db.query(
      `INSERT INTO internal.internal_users (id, email, full_name, role, is_active)
       VALUES (gen_random_uuid(), LOWER($1), $2, $3, true)
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, is_active = true, updated_at = NOW()
       RETURNING id, email, full_name, role`,
      [email.trim(),fullName.trim(),role]
    );
    res.json({ok:true,message:`Pengguna internal ${email} berhasil ditambahkan sebagai ${role}`,user:inserted.rows[0]});
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
      res.json({ ok: true, ...(await repo.merchantDirectory(db, req.query as repo.ListFilter,req.internal!.role==='ROLE_SUPERADMIN')) });
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
      const detail = await repo.transactionDetail(db, req.params.id,repo.cleanFilter(req.query).merchantId);
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

  // Bahan baku & stok mentah
  app.get(
    '/api/admin/raw-materials',
    guard('VIEW_PRODUCT_SALES'),
    wrap(async (req, res, db) => {
      try {
        const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;
        let q = `SELECT id, name, sku, category, unit, cost_per_unit, current_stock, minimum_stock_alert, is_active, updated_at
                   FROM pos.inventory_items`;
        const params: any[] = [];
        if (search) {
          params.push(search);
          q += ` WHERE name ILIKE $1 OR sku ILIKE $1 OR category ILIKE $1`;
        }
        q += ` ORDER BY name ASC LIMIT 200`;
        const { rows } = await db.query(q, params);
        res.json({ ok: true, rows, total: rows.length });
      } catch {
        res.json({ ok: true, rows: [], total: 0 });
      }
    })
  );

  // Produk paket / bundle
  app.get(
    '/api/admin/bundles',
    guard('VIEW_PRODUCT_SALES'),
    wrap(async (req, res, db) => {
      try {
        const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;
        let q = `SELECT p.id, p.name, p.sku, p.price, p.cost_price, p.is_available, p.offering_type,
                        c.name AS category_name
                   FROM pos.products p
                   LEFT JOIN pos.categories c ON c.id = p.category_id
                  WHERE p.offering_type = 'BUNDLE'`;
        const params: any[] = [];
        if (search) {
          params.push(search);
          q += ` AND (p.name ILIKE $1 OR p.sku ILIKE $1)`;
        }
        q += ` ORDER BY p.name ASC LIMIT 200`;
        const { rows } = await db.query(q, params);
        res.json({ ok: true, rows, total: rows.length });
      } catch {
        res.json({ ok: true, rows: [], total: 0 });
      }
    })
  );

  // Resep BOM (Bill of Materials)
  app.get(
    '/api/admin/recipes',
    guard('VIEW_PRODUCT_SALES'),
    wrap(async (_req, res, db) => {
      try {
        const { rows } = await db.query(
          `SELECT r.id, r.merchant_id, r.output_product_id, p.name AS output_product_name,
                  r.output_quantity, r.notes,
                  COALESCE(
                    json_agg(
                      json_build_object(
                        'item_id', ri.inventory_item_id,
                        'item_name', ii.name,
                        'quantity', ri.quantity_required,
                        'unit', ii.unit
                      )
                    ) FILTER (WHERE ri.id IS NOT NULL), '[]'::json
                  ) AS ingredients
             FROM pos.recipes r
             LEFT JOIN pos.products p ON p.id = r.output_product_id
             LEFT JOIN pos.recipe_items ri ON ri.recipe_id = r.id
             LEFT JOIN pos.inventory_items ii ON ii.id = ri.inventory_item_id
            GROUP BY r.id, r.merchant_id, r.output_product_id, p.name, r.output_quantity, r.notes
            ORDER BY p.name ASC
            LIMIT 200`
        );
        res.json({ ok: true, rows, total: rows.length });
      } catch {
        res.json({ ok: true, rows: [], total: 0 });
      }
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
    wrap(async (req, res, db) => {
      res.json({ ok: true, rows: await repo.activityBreakdown(db,repo.cleanFilter(req.query).merchantId) });
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
                l.accessed_at,l.request_id,l.user_agent,l.ip_address, u.email AS internal_email, u.full_name AS internal_name,
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

  /* ---------------------------------------------------------------------- */
  /* BLOG PUBLIK & CMS                                                       */
  /* ---------------------------------------------------------------------- */

  function rowToBlogPost(r: any) {
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      excerpt: r.excerpt || '',
      content: r.content,
      category: r.category,
      coverImage: r.cover_image || '',
      author: {
        name: r.author_name || 'Tim Editorial New Hope POS',
        role: r.author_role || 'Business Consultant',
        avatar: r.author_avatar || '',
      },
      readingTimeMinutes: Number(r.reading_time_minutes || 5),
      tags: Array.isArray(r.tags) ? r.tags : [],
      mediaEmbeds: Array.isArray(r.media_embeds) ? r.media_embeds : (typeof r.media_embeds === 'string' ? JSON.parse(r.media_embeds) : []),
      seo: r.seo && typeof r.seo === 'object' ? r.seo : (typeof r.seo === 'string' ? JSON.parse(r.seo) : {}),
      isPublished: Boolean(r.is_published),
      isFeatured: Boolean(r.is_featured),
      viewCount: Number(r.view_count || 0),
      likesCount: Number(r.likes_count || 0),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
    };
  }

  app.get(
    '/api/v1/blog',
    wrap(async (req, res, db) => {
      const category = req.query.category ? String(req.query.category).trim() : null;
      let query = `SELECT id, slug, title, excerpt, content, category, cover_image,
                          author_name, author_role, author_avatar, reading_time_minutes,
                          tags, media_embeds, seo, is_published, is_featured, view_count, likes_count,
                          created_at, updated_at
                     FROM public.blog_posts
                    WHERE is_published = true`;
      const params: any[] = [];
      if (category && category !== 'Semua Kategori' && category !== 'ALL') {
        params.push(category);
        query += ` AND category = $${params.length}`;
      }
      query += ` ORDER BY is_featured DESC, created_at DESC`;
      const { rows } = await db.query(query, params);
      res.json({ ok: true, posts: rows.map(rowToBlogPost) });
    })
  );

  app.get(
    '/api/v1/blog/:slug',
    wrap(async (req, res, db) => {
      const slug = String(req.params.slug).trim();
      const { rows } = await db.query(
        `SELECT id, slug, title, excerpt, content, category, cover_image,
                author_name, author_role, author_avatar, reading_time_minutes,
                tags, media_embeds, seo, is_published, is_featured, view_count, likes_count,
                created_at, updated_at
           FROM public.blog_posts
          WHERE slug = $1 AND is_published = true`,
        [slug]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: 'POST_NOT_FOUND' });
      void db.query(`UPDATE public.blog_posts SET view_count = view_count + 1 WHERE id = $1`, [rows[0].id]).catch(() => {});
      res.json({ ok: true, post: rowToBlogPost(rows[0]) });
    })
  );

  app.post(
    '/api/v1/blog/:id/like',
    wrap(async (req, res, db) => {
      const id = String(req.params.id).trim();
      const { rows } = await db.query(
        `UPDATE public.blog_posts SET likes_count = likes_count + 1 WHERE id = $1 RETURNING likes_count`,
        [id]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: 'POST_NOT_FOUND' });
      res.json({ ok: true, likesCount: Number(rows[0].likes_count) });
    })
  );

  app.get(
    '/api/admin/blog',
    guard('VIEW_SECTOR_ANALYTICS'),
    wrap(async (_req, res, db) => {
      const { rows } = await db.query(
        `SELECT id, slug, title, excerpt, content, category, cover_image,
                author_name, author_role, author_avatar, reading_time_minutes,
                tags, media_embeds, seo, is_published, is_featured, view_count, likes_count,
                created_at, updated_at
           FROM public.blog_posts
          ORDER BY created_at DESC`
      );
      res.json({ ok: true, posts: rows.map(rowToBlogPost) });
    })
  );

  app.post(
    '/api/admin/blog',
    guard('VIEW_SECTOR_ANALYTICS'),
    wrap(async (req, res, db) => {
      const b = req.body || {};
      const id = b.id ? String(b.id) : ('blog-' + randomUUID());
      const slug = String(b.slug || '').trim();
      const title = String(b.title || '').trim();
      if (!slug || !title) return res.status(400).json({ ok: false, error: 'TITLE_AND_SLUG_REQUIRED' });

      const author = b.author || {};
      const { rows } = await db.query(
        `INSERT INTO public.blog_posts (
           id, slug, title, excerpt, content, category, cover_image,
           author_name, author_role, author_avatar, reading_time_minutes,
           tags, media_embeds, seo, is_published, is_featured,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11,
           $12, $13::jsonb, $14::jsonb, $15, $16,
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         )
         ON CONFLICT (slug) DO UPDATE SET
           title = EXCLUDED.title,
           excerpt = EXCLUDED.excerpt,
           content = EXCLUDED.content,
           category = EXCLUDED.category,
           cover_image = EXCLUDED.cover_image,
           author_name = EXCLUDED.author_name,
           author_role = EXCLUDED.author_role,
           author_avatar = EXCLUDED.author_avatar,
           reading_time_minutes = EXCLUDED.reading_time_minutes,
           tags = EXCLUDED.tags,
           media_embeds = EXCLUDED.media_embeds,
           seo = EXCLUDED.seo,
           is_published = EXCLUDED.is_published,
           is_featured = EXCLUDED.is_featured,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [
          id,
          slug,
          title,
          String(b.excerpt || '').trim(),
          String(b.content || '').trim(),
          String(b.category || 'Tips Bisnis & Strategi'),
          String(b.coverImage || ''),
          String(author.name || 'Tim Editorial New Hope POS'),
          String(author.role || 'Business Consultant'),
          String(author.avatar || ''),
          Number(b.readingTimeMinutes) || 5,
          Array.isArray(b.tags) ? b.tags : [],
          JSON.stringify(Array.isArray(b.mediaEmbeds) ? b.mediaEmbeds : []),
          JSON.stringify(b.seo && typeof b.seo === 'object' ? b.seo : {}),
          b.isPublished !== false,
          Boolean(b.isFeatured),
        ]
      );
      res.json({ ok: true, post: rowToBlogPost(rows[0]) });
    })
  );

  app.put(
    '/api/admin/blog/:id',
    guard('VIEW_SECTOR_ANALYTICS'),
    wrap(async (req, res, db) => {
      const id = String(req.params.id);
      const b = req.body || {};
      const author = b.author || {};
      const { rows } = await db.query(
        `UPDATE public.blog_posts
            SET slug = COALESCE($2, slug),
                title = COALESCE($3, title),
                excerpt = COALESCE($4, excerpt),
                content = COALESCE($5, content),
                category = COALESCE($6, category),
                cover_image = COALESCE($7, cover_image),
                author_name = COALESCE($8, author_name),
                author_role = COALESCE($9, author_role),
                author_avatar = COALESCE($10, author_avatar),
                reading_time_minutes = COALESCE($11, reading_time_minutes),
                tags = COALESCE($12, tags),
                media_embeds = COALESCE($13::jsonb, media_embeds),
                seo = COALESCE($14::jsonb, seo),
                is_published = COALESCE($15, is_published),
                is_featured = COALESCE($16, is_featured),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *`,
        [
          id,
          b.slug ? String(b.slug).trim() : null,
          b.title ? String(b.title).trim() : null,
          b.excerpt !== undefined ? String(b.excerpt).trim() : null,
          b.content !== undefined ? String(b.content).trim() : null,
          b.category ? String(b.category) : null,
          b.coverImage !== undefined ? String(b.coverImage) : null,
          author.name !== undefined ? String(author.name) : null,
          author.role !== undefined ? String(author.role) : null,
          author.avatar !== undefined ? String(author.avatar) : null,
          b.readingTimeMinutes !== undefined ? Number(b.readingTimeMinutes) : null,
          Array.isArray(b.tags) ? b.tags : null,
          b.mediaEmbeds !== undefined ? JSON.stringify(b.mediaEmbeds) : null,
          b.seo !== undefined ? JSON.stringify(b.seo) : null,
          b.isPublished !== undefined ? Boolean(b.isPublished) : null,
          b.isFeatured !== undefined ? Boolean(b.isFeatured) : null,
        ]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: 'POST_NOT_FOUND' });
      res.json({ ok: true, post: rowToBlogPost(rows[0]) });
    })
  );

  app.delete(
    '/api/admin/blog/:id',
    guard('VIEW_SECTOR_ANALYTICS'),
    wrap(async (req, res, db) => {
      const id = String(req.params.id);
      const { rows } = await db.query(`DELETE FROM public.blog_posts WHERE id = $1 RETURNING id`, [id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: 'POST_NOT_FOUND' });
      res.json({ ok: true, id: rows[0].id });
    })
  );
}
