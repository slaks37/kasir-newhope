/**
 * billing-service — pemilik skema `billing`.
 *
 * Paket, langganan, faktur, dan webhook penyedia pembayaran.
 *
 * KENAPA DIPISAH. Domain langganan tidak punya hubungan dengan transaksi kasir
 * dan siklus ubahnya jauh lebih lambat. Menyatukannya berarti setiap perubahan
 * aturan harga ikut mempertaruhkan jalur penjualan.
 *
 * SEMUA KEADAAN ADA DI DATABASE. Versi sebelumnya menyimpan langganan di `Map`
 * dalam memori — restart mengembalikan semua merchant ke TRIAL termasuk yang
 * sudah membayar, dua replika melihat langganan berbeda, dan webhook yang tiba
 * setelah restart tidak menemukan langganan yang harus diaktifkan: uang masuk,
 * akses tidak. Lihat services/billing/store.ts.
 */

// WAJIB paling awal: PORTS dan SERVICE_URL dievaluasi saat modul dimuat,
// jadi .env harus sudah terbaca sebelum modul lain diimpor.
import '../shared/env';
import type express from 'express';
import { startService, PORTS } from '../shared/service';
import type { SaaSPlan } from '../../src/types';
import { newDocumentNumber } from '../../src/lib/ids';
import * as store from './store';

const SAAS_PLANS: SaaSPlan[] = [
  {
    id: 'plan-free',
    name: 'Free Tier',
    tierLevel: 1,
    billingCycle: 'MONTHLY',
    priceIdr: 0,
    currency: 'IDR',
    maxOutlets: 1,
    isActive: true,
    productLimit: 30,
    aiQuotaMonthly: 3,
    dashboardAccessLevel: 'BASIC',
    features: [
      'Basic POS & Transaksi',
      'Ringkasan Penjualan Harian',
      '1 Outlet / Cabang Toko',
      'Maksimal 30 Produk',
      'AI Analyst (3x / bulan)',
    ],
  },
  {
    id: 'plan-plus-monthly',
    name: 'Tier Plus',
    tierLevel: 2,
    billingCycle: 'MONTHLY',
    priceIdr: 99000,
    priceYearlyIdr: 79000,
    currency: 'IDR',
    maxOutlets: 2,
    isActive: true,
    productLimit: 100,
    aiQuotaMonthly: 30,
    dashboardAccessLevel: 'FULL',
    extraOutletPriceIdr: 59000,
    features: [
      'Full POS & Transaksi Kasir',
      'Manajemen Inventori Dasar',
      'Laporan & Dashboard Analytics',
      'Maksimal 100 Produk per Outlet',
      'Up to 2 Outlet Terdaftar',
      'AI Analyst (30x / bulan)',
    ],
  },
  {
    id: 'plan-pro-monthly',
    name: 'Tier Pro',
    tierLevel: 3,
    billingCycle: 'MONTHLY',
    priceIdr: 299000,
    priceYearlyIdr: 239000,
    currency: 'IDR',
    maxOutlets: 4,
    isActive: true,
    productLimit: -1, // Unlimited
    aiQuotaMonthly: 90,
    dashboardAccessLevel: 'ADVANCED',
    extraOutletPriceIdr: 49000,
    features: [
      'Full POS & Transaksi Lanjutan',
      'Manajemen Stok Lanjut & Bahan Baku',
      'Multi-Outlet Analytics & Laporan Lengkap',
      'Produk Tidak Terbatas (Unlimited)',
      'Up to 4 Outlet Terdaftar',
      'AI Analyst (90x / bulan)',
    ],
  },
];

const GRACE_DAYS = 3;
const TRIAL_DAYS = 45;
const HARI_MS = 86_400_000;

startService({
  name: 'billing',
  port: PORTS.billing,
  schema: 'billing',
  register: async (app, svc) => {
    await store.pastikanTabelFingerprint(svc.db);
    await store.pastikanPaket(svc.db, SAAS_PLANS);
    svc.log.info(`katalog paket disiapkan (${SAAS_PLANS.length} paket)`);

    const cariPaket = (id: string) => SAAS_PLANS.find((p) => p.id === id) ?? null;
    const tenantDari = (req: express.Request) =>
      String(
        req.body?.tenantId || req.query?.tenantId || req.headers['x-tenant-id'] || 'tenant-default'
      );

    /**
     * Kedaluwarsa DIHITUNG, tidak disimpan.
     *
     * Menyimpannya menuntut cron yang mengubah status tepat waktu; cron yang
     * telat semenit berarti merchant kedaluwarsa masih bisa berjualan, dan cron
     * yang mati semalam berarti semuanya masih aktif esok paginya. Menghitung
     * dari current_period_end selalu benar tanpa proses tambahan apa pun.
     */
    function statusEfektif(sub: { status: string; currentPeriodEnd: string }) {
      if (sub.status === 'CANCELED') return 'CANCELED';
      const akhir = new Date(sub.currentPeriodEnd).getTime();
      const now = Date.now();
      if (now <= akhir) return sub.status;
      if (now <= akhir + GRACE_DAYS * HARI_MS) return 'PAST_DUE';
      return 'EXPIRED';
    }

    app.get('/api/v1/subscription/plans', (_req, res) => {
      res.json({ ok: true, plans: SAAS_PLANS });
    });

    app.post('/api/v1/auth/send-welcome', async (req, res) => {
      const { email } = req.body || {};
      if (!email) return res.status(400).json({ ok: false, error: 'MISSING_EMAIL' });
      
      try {
        const { Resend } = await import('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        // Kirim Welcome Email
        await resend.emails.send({
          from: 'welcome@newhopepos.id',
          to: email,
          subject: 'Selamat Datang di New Hope POS!',
          html: `
            <div style="font-family: sans-serif; max-w-md; margin: 0 auto;">
              <h2>Pendaftaran Berhasil!</h2>
              <p>Halo,</p>
              <p>Akun kasir Anda dengan email <strong>${email}</strong> telah berhasil dibuat dan <strong>terkonfirmasi otomatis</strong>.</p>
              <p>Anda sudah bisa langsung masuk (login) ke dalam sistem menggunakan password yang baru saja Anda buat tanpa perlu memasukkan kode OTP apa pun.</p>
              <br/>
              <p>Selamat berjualan!<br/>Tim New Hope POS</p>
            </div>
          `
        });

        res.json({ ok: true });
      } catch (err: any) {
        svc.log.error('Custom signup gagal:', err);
        // Bila duplicate email, error code dari Postgres biasanya 23505
        if (err.code === '23505') {
          return res.status(400).json({ ok: false, error: 'User already registered' });
        }
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    app.get('/api/v1/subscription/status', async (req, res) => {
      const tenantId = tenantDari(req);
      const sub = await store.ambilAtauBuatLangganan(svc.db, tenantId, SAAS_PLANS[0].id, TRIAL_DAYS, req.headers['x-device-id'] as string, req.ip);
      if (!sub) {
        // Merchant belum tersinkronisasi ke database. Bukan error — hanya belum
        // ada apa pun untuk ditagih.
        return res.json({
          ok: true, subscription: null, plan: null, invoices: [],
          isActive: false, inGrace: false, reason: 'MERCHANT_BELUM_SINKRON',
        });
      }
      const efektif = statusEfektif(sub);
      res.json({
        ok: true,
        subscription: { ...sub, status: efektif },
        plan: cariPaket(sub.planId),
        invoices: await store.daftarFaktur(svc.db, tenantId),
        isActive: efektif === 'ACTIVE' || efektif === 'TRIAL',
        inGrace: efektif === 'PAST_DUE',
      });
    });

    app.post('/api/v1/subscription/checkout', async (req, res) => {
      const tenantId = tenantDari(req);
      const plan = cariPaket(String(req.body?.planId || ''));
      if (!plan) return res.status(400).json({ ok: false, error: 'PLAN_NOT_FOUND' });

      const sub = await store.ambilAtauBuatLangganan(svc.db, tenantId, SAAS_PLANS[0].id, TRIAL_DAYS, req.headers['x-device-id'] as string, req.ip);
      if (!sub) return res.status(409).json({ ok: false, error: 'MERCHANT_BELUM_SINKRON' });
      const faktur = await store.buatFaktur(svc.db, {
        nomor: newDocumentNumber('INV'),
        subscriptionId: sub.id,
        tenantId,
        amount: plan.priceIdr,
        dueDate: new Date(Date.now() + 3 * HARI_MS).toISOString(),
        linkUrl: `https://checkout.example.test/pay/${encodeURIComponent(tenantId)}`,
      });

      svc.log.info('checkout dibuat', { tenantId, planId: plan.id, invoice: faktur.id });
      res.json({ ok: true, invoice: faktur, plan });
    });

    /**
     * Simulasi pembayaran untuk pengembangan.
     *
     * DITUTUP di produksi. Kalau jalur ini terbuka, siapa pun yang bisa
     * mengirim HTTP dapat mengaktifkan langganannya sendiri tanpa membayar —
     * satu-satunya yang boleh mengaktifkan adalah webhook dari payment gateway.
     */
    app.post('/api/v1/subscription/simulate-payment', async (req, res) => {
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SIMULATED_PAYMENT !== '1') {
        return res.status(403).json({ ok: false, error: 'SIMULATION_DISABLED' });
      }

      const tenantId = tenantDari(req);
      const invoiceId = String(req.body?.invoiceId || '');
      const planId = String(req.body?.planId || '');

      const lunas = await store.tandaiFakturLunas(svc.db, invoiceId, 'SIMULATED');
      if (!lunas) return res.status(404).json({ ok: false, error: 'INVOICE_NOT_FOUND_OR_PAID' });

      const sub = await store.ambilAtauBuatLangganan(svc.db, tenantId, SAAS_PLANS[0].id, TRIAL_DAYS, req.headers['x-device-id'] as string, req.ip);
      if (!sub) return res.status(409).json({ ok: false, error: 'MERCHANT_BELUM_SINKRON' });
      if (planId && cariPaket(planId)) await store.gantiPaket(svc.db, sub.id, planId);

      const mulai = new Date();
      const diperbarui = await store.ubahStatusLangganan(svc.db, sub.id, 'ACTIVE', {
        mulai: mulai.toISOString(),
        selesai: new Date(mulai.getTime() + 30 * HARI_MS).toISOString(),
      });

      svc.log.info('pembayaran tersimulasi diterima', { tenantId, invoiceId });
      res.json({ ok: true, subscription: diperbarui, invoice: lunas });
    });

    app.post('/api/v1/subscription/prorated-upgrade', async (req, res) => {
      const tenantId = tenantDari(req);
      const planBaru = cariPaket(String(req.body?.planId || ''));
      if (!planBaru) return res.status(400).json({ ok: false, error: 'PLAN_NOT_FOUND' });

      const sub = await store.ambilLangganan(svc.db, tenantId);
      if (!sub) return res.status(404).json({ ok: false, error: 'NO_SUBSCRIPTION' });

      const lama = cariPaket(sub.planId);
      const sisaHari = Math.max(
        0,
        Math.ceil((new Date(sub.currentPeriodEnd).getTime() - Date.now()) / HARI_MS)
      );
      // Sisa periode paket LAMA dikreditkan; hanya selisihnya yang ditagih.
      // Menagih harga penuh saat upgrade di tengah periode berarti merchant
      // membayar dua kali untuk hari yang sama.
      const kreditSisa = Math.round(((lama?.priceIdr ?? 0) / 30) * sisaHari);
      const ditagih = Math.max(0, planBaru.priceIdr - kreditSisa);

      const faktur = await store.buatFaktur(svc.db, {
        nomor: newDocumentNumber('INV'),
        subscriptionId: sub.id,
        tenantId,
        amount: ditagih,
        dueDate: new Date(Date.now() + 3 * HARI_MS).toISOString(),
      });

      res.json({
        ok: true,
        invoice: faktur,
        breakdown: { hargaPaketBaru: planBaru.priceIdr, kreditSisa, sisaHari, ditagih },
      });
    });

    /**
     * Webhook payment gateway — IDEMPOTEN lewat event_id.
     *
     * Gateway mengirim ulang event yang tidak di-ACK tepat waktu; itu perilaku
     * normal, bukan kasus tepi. Tanpa penjaga ini satu pembayaran memperpanjang
     * langganan dua kali.
     */
    app.post('/api/v1/webhooks/payment-gateway', async (req, res) => {
      const body = req.body ?? {};
      const eventId = String(body.eventId || body.id || '');
      const eventType = String(body.eventType || body.type || 'UNKNOWN');
      if (!eventId) return res.status(400).json({ ok: false, error: 'EVENT_ID_REQUIRED' });

      const baru = await store.catatWebhookBaru(svc.db, eventId, eventType, body);
      if (!baru) {
        // 200, bukan error. Bagi gateway ini "sudah berhasil diproses";
        // menjawab error membuatnya mengirim ulang tanpa henti.
        svc.log.info('webhook diulang, dilewati', { eventId, eventType });
        return res.json({ ok: true, replayed: true });
      }

      if (eventType === 'payment.succeeded' || eventType === 'invoice.paid') {
        const invoiceId = String(body.invoiceId || body.data?.invoiceId || '');
        const tenantId = String(body.tenantId || body.data?.tenantId || '');
        const lunas = invoiceId ? await store.tandaiFakturLunas(svc.db, invoiceId, eventId) : null;

        if (tenantId) {
          const sub = await store.ambilAtauBuatLangganan(
            svc.db, tenantId, SAAS_PLANS[0].id, TRIAL_DAYS
          );
          if (!sub) {
            svc.log.warn('webhook untuk merchant yang belum tersinkronisasi', { tenantId, eventId });
            return res.json({ ok: true, replayed: false, warning: 'MERCHANT_BELUM_SINKRON' });
          }
          const mulai = new Date();
          await store.ubahStatusLangganan(svc.db, sub.id, 'ACTIVE', {
            mulai: mulai.toISOString(),
            selesai: new Date(mulai.getTime() + 30 * HARI_MS).toISOString(),
          });
        }
        svc.log.info('pembayaran diterima', { eventId, invoiceId, tenantId, lunas: !!lunas });
      }

      res.json({ ok: true, replayed: false });
    });
  },
});
