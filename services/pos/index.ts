/**
 * pos-service — pemilik skema `pos`.
 *
 * Satu-satunya service yang boleh MENULIS transaksi, katalog, staf, dan jejak
 * aktivitas. Semua service lain membacanya lewat view di skema `contract`, dan
 * Postgres yang menegakkan aturan itu — bukan kesepakatan tim.
 *
 * Jalur tulis terpenting di seluruh sistem ada di sini: sinkronisasi antrian
 * kasir. Kalau jalur ini menggandakan baris, omzet merchant ikut berlipat dan
 * tidak ada layar yang bisa memperbaikinya.
 */

// WAJIB paling awal: PORTS dan SERVICE_URL dievaluasi saat modul dimuat,
// jadi .env harus sudah terbaca sebelum modul lain diimpor.
import '../shared/env';
import express from 'express';
import { startService, PORTS } from '../shared/service';
import { registerSyncRoutes } from './sync';

startService({
  name: 'pos',
  port: PORTS.pos,
  schema: 'pos',
  register: (app, ctx) => {
    registerSyncRoutes(app, ctx.db);

    /**
     * Agregat internal untuk ai-service.
     *
     * ai-service TIDAK memanggil endpoint ini untuk angka uang — itu dibaca
     * langsung dari contract.merchant_revenue, supaya definisi omzetnya
     * dijamin sama. Endpoint ini hanya melayani hal yang butuh logika pos:
     * memetakan business_id ke merchant.
     */
    app.get('/internal/resolve-tenant', async (req, res) => {
      const businessId = String(req.query.businessId || '').trim();
      if (!businessId) return res.status(400).json({ ok: false, error: 'BUSINESS_ID_REQUIRED' });

      const { rows } = await ctx.db.query(
        `SELECT id, name, business_sector FROM internal.tenants WHERE external_ref = $1`,
        [businessId]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
      res.json({ ok: true, tenant: rows[0] });
    });

    /** Ringkasan operasional satu merchant. Dipakai gateway untuk kartu status. */
    app.get('/internal/merchant/:merchantId/summary', async (req, res) => {
      const { rows } = await ctx.db.query(
        `SELECT COUNT(*)::int AS products,
                COUNT(*) FILTER (WHERE stock <= min_stock_alert)::int AS low_stock
           FROM pos.products WHERE tenant_id = $1::uuid AND is_available`,
        [req.params.merchantId]
      );
      res.json({ ok: true, ...rows[0] });
    });
  },
});
