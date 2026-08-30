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
import { SAAS_PLANS } from '../../src/data/saasPlans';
import { newDocumentNumber } from '../../src/lib/ids';
import * as store from './store';
import { tenantForPrincipal, trustedPrincipal } from '../shared/auth';
import {
  createDokuCheckout,
  verifyDokuWebhookSignature,
  isDokuConfigured,
  type DokuWebhookNotification,
} from './doku';


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
    const tenantDari = async (req: express.Request): Promise<string | null> => {
      const principal = trustedPrincipal(req);
      if (!principal) return null;
      if (principal.subject === 'local-development') {
        return String(req.body?.tenantId || req.query?.tenantId || req.headers['x-tenant-id'] || 'tenant-default');
      }
      // tenant ID klien sengaja diabaikan: hanya owner_ref dari token yang
      // menentukan langganan/faktur mana yang boleh dibaca atau diubah.
      return tenantForPrincipal(svc.db, principal);
    };

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
        res.status(500).json({ ok: false, error: 'WELCOME_EMAIL_FAILED' });
      }
    });

    app.get('/api/v1/subscription/status', async (req, res) => {
      const tenantId = await tenantDari(req);
      if (!tenantId) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
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
      const tenantId = await tenantDari(req);
      if (!tenantId) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
      const plan = cariPaket(String(req.body?.planId || ''));
      if (!plan) return res.status(400).json({ ok: false, error: 'PLAN_NOT_FOUND' });

      const isYearly = req.body?.billingCycle === 'YEARLY';
      const amount = isYearly && plan.priceYearlyIdr !== undefined ? plan.priceYearlyIdr * 12 : plan.priceIdr;

      const sub = await store.ambilAtauBuatLangganan(
        svc.db,
        tenantId,
        SAAS_PLANS[0].id,
        TRIAL_DAYS,
        req.headers['x-device-id'] as string,
        req.ip
      );
      if (!sub) return res.status(409).json({ ok: false, error: 'MERCHANT_BELUM_SINKRON' });

      const invoiceNumber = newDocumentNumber('INV');
      let paymentUrl: string | undefined = undefined;

      const callbackUrl = `${process.env.GATEWAY_URL || 'http://localhost:3000'}/settings?tab=subscription`;

      if (isDokuConfigured() && amount > 0) {
        try {
          const dokuRes = await createDokuCheckout({
            order: {
              invoice_number: invoiceNumber,
              amount,
              currency: 'IDR',
              callback_url: callbackUrl,
              auto_redirect: true,
              line_items: [
                {
                  name: `Paket ${plan.name} (${isYearly ? 'Tahunan' : 'Bulanan'})`,
                  price: amount,
                  quantity: 1,
                },
              ],
            },
            payment: {
              payment_due_date: 60, // 60 menit
            },
            customer: {
              id: tenantId,
              name: `Merchant ${tenantId.slice(0, 8)}`,
              email: req.headers['x-auth-email']
                ? String(req.headers['x-auth-email'])
                : 'merchant@newhopepos.id',
            },
          });
          paymentUrl = dokuRes.paymentUrl;
        } catch (err: any) {
          svc.log.error('gagal memanggil DOKU checkout:', { err: err.message, tenantId, planId: plan.id });
          return res.status(500).json({
            ok: false,
            error: 'DOKU_CHECKOUT_FAILED',
            detail: err.message,
          });
        }
      } else {
        paymentUrl = `https://checkout.example.test/pay/${encodeURIComponent(tenantId)}?inv=${invoiceNumber}`;
      }

      const faktur = await store.buatFaktur(svc.db, {
        nomor: invoiceNumber,
        subscriptionId: sub.id,
        tenantId,
        amount,
        dueDate: new Date(Date.now() + 3 * HARI_MS).toISOString(),
        linkUrl: paymentUrl,
      });

      svc.log.info('checkout dibuat', { tenantId, planId: plan.id, invoice: faktur.id, paymentUrl });
      res.json({ ok: true, invoice: faktur, plan, paymentUrl });
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

      const tenantId = await tenantDari(req);
      if (!tenantId) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
      const invoiceId = String(req.body?.invoiceId || '');
      const planId = String(req.body?.targetPlanId || req.body?.planId || '');

      let lunas = invoiceId ? await store.tandaiFakturLunas(svc.db, invoiceId, 'SIMULATED', tenantId) : null;

      const sub = await store.ambilAtauBuatLangganan(
        svc.db,
        tenantId,
        SAAS_PLANS[0].id,
        TRIAL_DAYS,
        req.headers['x-device-id'] as string,
        req.ip
      );
      if (!sub) return res.status(409).json({ ok: false, error: 'MERCHANT_BELUM_SINKRON' });
      if (planId && cariPaket(planId)) await store.gantiPaket(svc.db, sub.id, planId);

      const mulai = new Date();
      const diperbarui = await store.ubahStatusLangganan(svc.db, sub.id, 'ACTIVE', {
        mulai: mulai.toISOString(),
        selesai: new Date(mulai.getTime() + 30 * HARI_MS).toISOString(),
      });

      if (!lunas) {
        // Buat faktur lunas dummy bila belum ada invoiceId
        const plan = cariPaket(planId) || SAAS_PLANS[1];
        const newInv = await store.buatFaktur(svc.db, {
          nomor: newDocumentNumber('INV'),
          subscriptionId: sub.id,
          tenantId,
          amount: plan.priceIdr,
          dueDate: new Date().toISOString(),
        });
        lunas = await store.tandaiFakturLunas(svc.db, newInv.id, 'SIMULATED', tenantId);
      }

      svc.log.info('pembayaran tersimulasi diterima', { tenantId, invoiceId: lunas?.id });
      res.json({
        ok: true,
        success: true,
        message: 'Pembayaran langganan berhasil disimulasikan! Paket sekarang aktif.',
        subscription: diperbarui,
        invoice: lunas,
      });
    });

    app.post('/api/v1/subscription/prorated-upgrade', async (req, res) => {
      const tenantId = await tenantDari(req);
      if (!tenantId) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
      const targetPlanId = String(req.body?.targetPlanId || req.body?.planId || '');
      const planBaru = cariPaket(targetPlanId);
      if (!planBaru) return res.status(400).json({ ok: false, error: 'PLAN_NOT_FOUND' });

      const sub = await store.ambilLangganan(svc.db, tenantId);
      if (!sub) return res.status(404).json({ ok: false, error: 'NO_SUBSCRIPTION' });

      const lama = cariPaket(sub.planId) || SAAS_PLANS[0];
      const sisaHari = Math.max(
        0,
        Math.ceil((new Date(sub.currentPeriodEnd).getTime() - Date.now()) / HARI_MS)
      );
      // Sisa periode paket LAMA dikreditkan; hanya selisihnya yang ditagih.
      const kreditSisa = Math.round(((lama?.priceIdr ?? 0) / 30) * sisaHari);
      const ditagih = Math.max(0, planBaru.priceIdr - kreditSisa);

      const invoiceNumber = newDocumentNumber('INV');
      let paymentUrl: string | undefined = undefined;

      if (isDokuConfigured() && ditagih > 0) {
        const callbackUrl = `${process.env.GATEWAY_URL || 'http://localhost:3000'}/settings?tab=subscription`;
        try {
          const dokuRes = await createDokuCheckout({
            order: {
              invoice_number: invoiceNumber,
              amount: ditagih,
              currency: 'IDR',
              callback_url: callbackUrl,
              auto_redirect: true,
              line_items: [
                {
                  name: `Upgrade Prorasi: ${lama.name} -> ${planBaru.name}`,
                  price: ditagih,
                  quantity: 1,
                },
              ],
            },
            payment: {
              payment_due_date: 60,
            },
            customer: {
              id: tenantId,
              name: `Merchant ${tenantId.slice(0, 8)}`,
              email: req.headers['x-auth-email']
                ? String(req.headers['x-auth-email'])
                : 'merchant@newhopepos.id',
            },
          });
          paymentUrl = dokuRes.paymentUrl;
        } catch (err: any) {
          svc.log.error('gagal memanggil DOKU checkout untuk upgrade prorasi:', err);
        }
      }

      const faktur = await store.buatFaktur(svc.db, {
        nomor: invoiceNumber,
        subscriptionId: sub.id,
        tenantId,
        amount: ditagih,
        dueDate: new Date(Date.now() + 3 * HARI_MS).toISOString(),
        linkUrl: paymentUrl,
      });

      res.json({
        ok: true,
        invoice: faktur,
        paymentUrl,
        currentPlan: lama,
        targetPlan: planBaru,
        remainingDays: sisaHari,
        unusedCredit: kreditSisa,
        netProratedAmount: ditagih,
        breakdown: { hargaPaketBaru: planBaru.priceIdr, kreditSisa, sisaHari, ditagih },
      });
    });

    /**
     * Webhook DOKU Payment Gateway — IDEMPOTEN & TERVERIFIKASI HMAC-SHA256.
     *
     * Menangani notifikasi pembayaran sukses dari DOKU Checkout / Jokul.
     */
    app.post('/api/v1/webhooks/doku', async (req, res) => {
      const rawBody = (req as any).rawBody || JSON.stringify(req.body ?? {});
      const isSignatureValid = verifyDokuWebhookSignature(
        req.headers,
        rawBody,
        '/api/v1/webhooks/doku'
      );

      const body = (req.body ?? {}) as DokuWebhookNotification;
      const invoiceNumber = String(body.order?.invoice_number || body.invoice_number || '');

      /*
       * TANDA TANGAN DITOLAK TANPA SYARAT.
       *
       * Endpoint ini publik — ada di PUBLIC_API_PATHS gateway, jadi tidak ada
       * Bearer token yang menjaganya. Tanda tangan HMAC adalah SATU-SATUNYA
       * pembeda antara notifikasi DOKU dan siapa pun yang tahu URL-nya.
       *
       * Syaratnya dulu berbunyi:
       *
       *   if (!valid && isDokuConfigured() && NODE_ENV === 'production')
       *
       * yang berarti penolakan hanya terjadi bila KETIGANYA benar. Di staging,
       * di `npm start` tanpa Docker, atau di mana pun NODE_ENV tidak persis
       * 'production', request tak bertanda tangan yang membawa nomor faktur
       * yang benar akan MENGAKTIFKAN LANGGANAN 30 HARI. Menumpangkan keputusan
       * keamanan pada NODE_ENV membuat celahnya berpindah-pindah mengikuti cara
       * proses dijalankan — bukan mengikuti keputusan siapa pun.
       *
       * Sekarang gerbangnya fail-closed. Kelonggaran untuk pengembangan lokal
       * harus diminta eksplisit lewat DOKU_WEBHOOK_INSECURE=1, yang menyebut
       * dirinya sendiri apa adanya dan tidak mungkin aktif tanpa sengaja.
       */
      if (!isSignatureValid) {
        if (process.env.DOKU_WEBHOOK_INSECURE === '1') {
          svc.log.warn('Webhook DOKU tanpa tanda tangan sah DITERIMA — DOKU_WEBHOOK_INSECURE=1', {
            invoiceNumber,
          });
        } else {
          // Header TIDAK ikut dicatat. Isinya memuat Signature, Client-Id, dan
          // — karena request lewat gateway — x-newhope-gateway-token. Menulis
          // seluruh header ke log berarti membocorkan token yang membedakan
          // pemanggil tepercaya dari yang bukan ke setiap agregator log.
          svc.log.warn('Webhook DOKU ditolak: tanda tangan HMAC-SHA256 tidak sah', {
            invoiceNumber,
            clientId: String(req.headers['client-id'] || ''),
            requestId: String(req.headers['request-id'] || ''),
            dokuTerkonfigurasi: isDokuConfigured(),
          });
          return res.status(401).json({ ok: false, error: 'INVALID_SIGNATURE' });
        }
      }

      /*
       * KESEGARAN TIMESTAMP.
       *
       * Tanda tangan membuktikan pesannya asli, bukan bahwa ia BARU. Notifikasi
       * sah yang pernah lewat kabel tetap sah selamanya, jadi siapa pun yang
       * berhasil merekamnya bisa mengirim ulang kapan saja.
       *
       * Idempotensi `eventId` di bawah sudah menahan pengulangan event YANG
       * SAMA; jendela ini menahan pengulangan yang datang dengan Request-Id
       * baru. Lima menit mengikuti anjuran DOKU dan cukup longgar untuk selisih
       * jam antar-server yang wajar.
       *
       * Dilewati kalau header waktunya tidak ada — beberapa jenis notifikasi
       * memang tidak membawanya, dan menolak semuanya berarti pembayaran yang
       * sah tidak pernah tercatat.
       */
      const stempel = String(req.headers['request-timestamp'] || '').trim();
      if (isSignatureValid && stempel) {
        const selisihMs = Math.abs(Date.now() - Date.parse(stempel));
        if (Number.isFinite(selisihMs) && selisihMs > 5 * 60_000) {
          svc.log.warn('Webhook DOKU ditolak: stempel waktu kedaluwarsa', {
            invoiceNumber,
            stempel,
            selisihDetik: Math.round(selisihMs / 1000),
          });
          return res.status(401).json({ ok: false, error: 'STALE_TIMESTAMP' });
        }
      }

      const transactionStatus = String(body.transaction?.status || body.status || 'UNKNOWN').toUpperCase();
      const eventId = String(
        req.headers['request-id'] ||
        body.transaction?.original_request_id ||
        `${invoiceNumber}-${Date.now()}`
      );

      if (!invoiceNumber) {
        svc.log.warn('Webhook DOKU tanpa nomor invoice', { body });
        return res.status(400).json({ ok: false, error: 'INVOICE_NUMBER_REQUIRED' });
      }

      // Idempotensi: Catat event ke database agar tidak diproses berulang
      const baru = await store.catatWebhookBaru(svc.db, eventId, `DOKU_${transactionStatus}`, body);
      if (!baru) {
        svc.log.info('Webhook DOKU duplikat dilewati', { eventId, invoiceNumber });
        return res.status(200).json({ status: 'SUCCESS', replayed: true });
      }

      if (transactionStatus === 'SUCCESS') {
        const lunas = await store.tandaiFakturLunas(svc.db, invoiceNumber, eventId);
        if (lunas) {
          const sub = await store.ambilLangganan(svc.db, lunas.tenantId);
          if (sub) {
            const mulai = new Date();
            await store.ubahStatusLangganan(svc.db, sub.id, 'ACTIVE', {
              mulai: mulai.toISOString(),
              selesai: new Date(mulai.getTime() + 30 * HARI_MS).toISOString(),
            });
            svc.log.info('Langganan berhasil diaktifkan via DOKU Webhook', {
              invoiceNumber,
              tenantId: lunas.tenantId,
              amount: lunas.amount,
            });
          }
        } else {
          svc.log.warn('Faktur tidak ditemukan atau sudah lunas', { invoiceNumber });
        }
      }

      // DOKU mewajibkan HTTP 200 sebagai acknowledgment
      res.status(200).json({ status: 'SUCCESS' });
    });

    /**
     * Webhook payment gateway umum — IDEMPOTEN lewat event_id.
     */
    app.post('/api/v1/webhooks/payment-gateway', async (req, res) => {
      const secret = process.env.PAYMENT_WEBHOOK_SECRET;
      if (!secret || String(req.headers['x-payment-webhook-secret'] || '') !== secret) {
        return res.status(401).json({ ok: false, error: 'INVALID_WEBHOOK_SIGNATURE' });
      }
      const body = req.body ?? {};
      const eventId = String(body.eventId || body.id || '');
      const eventType = String(body.eventType || body.type || 'UNKNOWN');
      if (!eventId) return res.status(400).json({ ok: false, error: 'EVENT_ID_REQUIRED' });

      const baru = await store.catatWebhookBaru(svc.db, eventId, eventType, body);
      if (!baru) {
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
