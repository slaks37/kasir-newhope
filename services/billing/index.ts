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
import { newDocumentNumber } from '../../src/lib/ids';
import {
  statusEfektif,
  langgananAktif,
  dalamTenggang,
  sisaHari,
} from '../../src/lib/plans/expiry';
import * as store from './store';

/**
 * KATALOG PAKET TIDAK LAGI DITULIS DI SINI.
 *
 * Dulu berkas ini memegang `SAAS_PLANS` sebagai konstanta, lalu melakukan dua
 * hal yang saling meniadakan dengan panel admin:
 *
 *   1. `pastikanPaket()` menjalankan ON CONFLICT DO UPDATE atas harga pada
 *      SETIAP boot. Admin menurunkan harga Tier Plus lewat panel, service
 *      di-restart, dan harganya kembali ke angka yang ditulis di kode — tanpa
 *      error, tanpa jejak, dan tanpa ada yang menyadarinya sampai ada merchant
 *      yang menagih selisihnya.
 *   2. `/api/v1/subscription/plans` menyajikan konstanta itu, bukan isi
 *      database. Jadi merchant tidak pernah melihat harga yang benar-benar
 *      berlaku.
 *
 * Sejak 0014 katalognya ada di `billing.plans` dan di-seed oleh migrasi — yang
 * sengaja TIDAK menimpa baris yang sudah pernah disunting admin. Service ini
 * sekarang membacanya, tidak memilikinya.
 */

const PAKET_BAWAAN = 'plan-free';

const TRIAL_DAYS = 45;
const HARI_MS = 86_400_000;

startService({
  name: 'billing',
  port: PORTS.billing,
  schema: 'billing',
  register: async (app, svc) => {
    await store.pastikanTabelFingerprint(svc.db);
    const jumlahPaket = await store.hitungPaket(svc.db);
    svc.log.info(`katalog paket dibaca dari database (${jumlahPaket} paket)`);
    if (jumlahPaket === 0) {
      // Migrasi 0014 yang mengisinya. Kalau kosong, migrasinya belum jalan —
      // dan menambal diam-diam di sini akan menyembunyikan penyebabnya.
      svc.log.warn('billing.plans kosong. Jalankan `npm run db:migrate` sebelum melayani langganan.');
    }

    const cariPaket = (id: string) => store.ambilPaket(svc.db, id);
    const tenantDari = (req: express.Request) =>
      String(
        req.body?.tenantId || req.query?.tenantId || req.headers['x-tenant-id'] || 'tenant-default'
      );

    // Hanya paket yang sedang DIJUAL. Paket yang disembunyikan admin tetap
    // berlaku bagi yang sudah berlangganan, tapi tidak boleh muncul di kartu
    // harga sebagai pilihan baru.
    app.get('/api/v1/subscription/plans', async (_req, res) => {
      res.json({ ok: true, plans: await store.daftarPaketAktif(svc.db) });
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
      const sub = await store.ambilAtauBuatLangganan(svc.db, tenantId, PAKET_BAWAAN, TRIAL_DAYS, req.headers['x-device-id'] as string, req.ip);
      if (!sub) {
        // Merchant belum tersinkronisasi ke database. Bukan error — hanya belum
        // ada apa pun untuk ditagih.
        return res.json({
          ok: true, subscription: null, plan: null, invoices: [], daysLeft: 0,
          isActive: false, inGrace: false, reason: 'MERCHANT_BELUM_SINKRON',
        });
      }
      const efektif = statusEfektif(sub.status, sub.currentPeriodEnd);
      const paket = await cariPaket(sub.planId);
      res.json({
        ok: true,
        // `plan` dikirim dua kali dengan sengaja: di dalam `subscription` untuk
        // pemanggil yang membaca langganan sebagai satu objek utuh, dan di akar
        // untuk yang langsung membaca entitlement. Jalur Vercel mengirim
        // keduanya juga — bentuk balasan kedua jalur harus sama persis, karena
        // aplikasi kasir tidak tahu jalur mana yang melayaninya.
        subscription: { ...sub, status: efektif, plan: paket },
        plan: paket,
        invoices: await store.daftarFaktur(svc.db, tenantId),
        daysLeft: sisaHari(sub.currentPeriodEnd),
        isActive: langgananAktif(efektif),
        inGrace: dalamTenggang(efektif),
      });
    });

    app.post('/api/v1/subscription/checkout', async (req, res) => {
      const tenantId = tenantDari(req);
      const plan = await cariPaket(String(req.body?.planId || ''));
      if (!plan) return res.status(400).json({ ok: false, error: 'PLAN_NOT_FOUND' });

      const sub = await store.ambilAtauBuatLangganan(svc.db, tenantId, PAKET_BAWAAN, TRIAL_DAYS, req.headers['x-device-id'] as string, req.ip);
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

      const sub = await store.ambilAtauBuatLangganan(svc.db, tenantId, PAKET_BAWAAN, TRIAL_DAYS, req.headers['x-device-id'] as string, req.ip);
      if (!sub) return res.status(409).json({ ok: false, error: 'MERCHANT_BELUM_SINKRON' });
      if (planId && (await cariPaket(planId))) await store.gantiPaket(svc.db, sub.id, planId);

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
      const planBaru = await cariPaket(String(req.body?.planId || ''));
      if (!planBaru) return res.status(400).json({ ok: false, error: 'PLAN_NOT_FOUND' });

      const sub = await store.ambilLangganan(svc.db, tenantId);
      if (!sub) return res.status(404).json({ ok: false, error: 'NO_SUBSCRIPTION' });

      const lama = await cariPaket(sub.planId);
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
            svc.db, tenantId, PAKET_BAWAAN, TRIAL_DAYS
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
