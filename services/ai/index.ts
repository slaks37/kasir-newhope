/**
 * ai-service — pemilik skema `ai`.
 *
 * Menangani AI Copilot: perutean intent, jawaban deterministik, dompet kredit,
 * dan jalur LLM berbayar.
 *
 * KENAPA DIPISAH. Bukan demi skala — demi ISOLASI KEGAGALAN. Panggilan ke
 * DeepSeek bisa menggantung sampai 30 detik. Di dalam satu proses bersama,
 * request kasir mengantre di belakangnya. Sebagai proses tersendiri, penyedia
 * LLM yang lambat hanya memperlambat AI, dan kasir tetap bisa menjual.
 *
 * AKSES DATA. Angka uang dibaca dari `contract.merchant_revenue` — view yang
 * sama persis dengan yang dipakai admin panel. Service ini bahkan tidak PUNYA
 * hak baca ke pos.transactions; Postgres menolaknya. Kesamaan angka antara
 * copilot dan panel karenanya bersifat struktural, bukan hasil disiplin.
 */

// WAJIB paling awal: PORTS dan SERVICE_URL dievaluasi saat modul dimuat,
// jadi .env harus sudah terbaca sebelum modul lain diimpor.
import '../shared/env';
import express from 'express';
import { startService, PORTS } from '../shared/service';
import { getLlmConfig, callLlm, LLM_PROVIDER_LABEL, LLM_TIMEOUT_MS } from './llm';
import { buildAggregatesFromDb, mergeWithClient } from './merchantData';
import { ambilDompet, pakaiKredit, kembalikanKredit, tambahKredit, catatAudit, ringkasanAudit } from './wallet';
import {
  AiCreditWallet,
  AssistantAnswer,
  AssistantQueryRequest,
  AssistantQueryResponse,
  INTENT_CONFIDENCE_THRESHOLD,
  IntentName,
  ParsedIntent,
} from '../../src/lib/assistant/types';
import { parseIntent, resolveIntentFromAggregates, QUICK_CHIPS } from '../../src/lib/assistant/intents';
import { newId } from '../../src/lib/ids';

startService({
  name: 'ai',
  port: PORTS.ai,
  schema: 'ai',
  register: (app, svc) => {
    // `svc` bukan `ctx`: di dalam handler, `ctx` sudah dipakai untuk konteks
    // tenant (businessId, sektor, peran). Dua hal berbeda dengan nama sama
    // adalah cara paling mudah menulis bug yang lolos type-check.
    const db = () => Promise.resolve(svc.db);
  
  const ADDON_PRICE_IDR = 49000;
  const ADDON_CREDITS = 50;

  /*
   * Dompet kredit dan jejak audit TIDAK LAGI di memori.
   *
   * Sebelumnya keduanya `Map` — warisan monolit. Akibatnya nyata: restart
   * mengembalikan saldo semua merchant ke 30 (biaya LLM yang benar-benar
   * keluar), dan dua replika ai-service berarti batas 30 kredit menjadi 60.
   * Sekarang keduanya di skema `ai`, dengan pengurangan saldo yang atomik di
   * SQL. Lihat services/ai/wallet.ts.
   */

  function chipSuggestions() {
    return QUICK_CHIPS.map((c) => ({ label: c.label, query: c.label }));
  }
  
  /**
   * POST /api/v1/assistant/query
   *
   * Order of operations is the whole cost-control story:
   *   quick-chip bypass -> intent parse -> deterministic answer (Rp 0)
   *   -> only then credits -> only then the model.
   */
  app.post('/api/v1/assistant/query', async (req, res) => {
    const startedAt = Date.now();
    const body = (req.body || {}) as AssistantQueryRequest;
    const merchantId =
      body.merchantId || (req.headers['x-tenant-id'] as string) || 'tenant-default';
    const queryText = (body.query || '').trim();
  
    /*
     * Tenant scope is resolved FIRST — before the responder, before parsing,
     * before any credit decision. `businessId` is the partition key the client
     * computed; it identifies WHICH of the merchant's businesses this question is
     * about, is recorded on every audit row, and is stated verbatim in the
     * model's system prompt.
     */
    const ctx = {
      businessId:
        body.storeContext?.businessId ||
        `${merchantId}_${body.storeContext?.businessSector || 'FNB'}`,
      storeName: body.storeContext?.storeName || 'Toko Anda',
      businessSector: body.storeContext?.businessSector || 'FNB',
      slotNoun: body.storeContext?.slotNoun || 'Meja',
      userRole: body.storeContext?.userRole || 'ADMIN',
    };

    // Dompet diambil SESUDAH ctx terbentuk: kredit dimiliki UNIT USAHA, dan
    // unit usaha hanya diketahui dari ctx.businessId. Mengambilnya lebih dulu
    // membuat kredit kafe terpotong untuk pertanyaan tentang laundry.
    const wallet = await ambilDompet(svc.db, merchantId, ctx.businessId);
  
    const respond = (
      answer: AssistantAnswer,
      extra: Partial<AssistantQueryResponse> = {},
      usage?: { promptTokens: number; completionTokens: number }
    ) => {
      const latencyMs = Date.now() - startedAt;
      answer.latencyMs = latencyMs;
      // Sengaja tidak di-await: jawaban yang sudah benar tidak boleh menunggu
      // penulisan audit, dan kegagalan penulisan sudah ditelan di dalamnya.
      void catatAudit(svc.db, {
        merchantId,
        businessId: ctx.businessId,
        query: queryText || `[chip:${answer.intent}]`,
        intent: answer.intent,
        source: answer.source,
        creditsCharged: answer.costCredits,
        latencyMs,
        model: usage ? getLlmConfig()?.model ?? null : null,
        promptTokens: usage?.promptTokens ?? null,
        completionTokens: usage?.completionTokens ?? null,
      });
      const payload: AssistantQueryResponse = { ok: true, answer, credits: wallet, ...extra };
      res.json(payload);
    };
  
    try {
  
      /* --- (b) Quick Chip bypass: never touches the NL parser --------------- */
      let parsed: ParsedIntent;
      if (body.intent && body.intent !== 'UNKNOWN') {
        parsed = { intent: body.intent, confidence: 1, entities: {}, matchedKeywords: ['quick-chip'] };
      } else {
        parsed = parseIntent(queryText);
      }
  
      /* --- (c) Data resolution — DATABASE FIRST ----------------------------- */
      //
      // Sumber data yang sama dengan admin panel, dengan rumus yang sama, dibatasi
      // pada tenant ini saja. Angka kiriman klien hanya dipakai untuk bidang yang
      // memang belum punya tabel (pelanggan, meja, staf bertugas) — tidak pernah
      // untuk angka uang.
      //
      // Kalau database tidak bisa dihubungi, kita mundur ke agregat klien
      // ketimbang menolak melayani: copilot yang mati total lebih buruk daripada
      // copilot yang menjawab dari data perangkat, selama asal datanya disebutkan.
      let aggregates = body.aggregates;
      let provenance: Record<string, string> = aggregates ? { '*': 'CLIENT' } : {};
      let dataSource: 'DATABASE' | 'CLIENT' | 'NONE' = aggregates ? 'CLIENT' : 'NONE';
  
      try {
        const database = await db();
        const fromDb = await buildAggregatesFromDb(database, ctx.businessId);
        if (fromDb.aggregates) {
          const merged = mergeWithClient(fromDb.aggregates, body.aggregates, fromDb.provenance);
          aggregates = merged.aggregates;
          provenance = merged.provenance;
          dataSource = 'DATABASE';
        }
      } catch (err) {
        console.error('[assistant] gagal membaca database, memakai agregat klien:', (err as Error).message);
      }
  
      /* --- (d) Deterministic path — the 90% case, always free --------------- */
      const knownIntent = parsed.intent !== 'UNKNOWN' && parsed.confidence >= INTENT_CONFIDENCE_THRESHOLD;
  
      if (knownIntent && aggregates) {
        const answer = resolveIntentFromAggregates(parsed, aggregates, body.insights ?? [], ctx);
        if (answer) {
          answer.costCredits = 0;
          return respond(answer, { dataSource, provenance });
        }
      }
  
      // We understood the question but the caller shipped no aggregated context.
      // Escalating to a billed model here would charge for our own missing input.
      if (knownIntent && !aggregates) {
        return respond({
          source: 'RULE_ENGINE',
          intent: parsed.intent,
          title: 'Konteks data belum dikirim',
          markdown:
            '**Pertanyaan Anda sudah dikenali, tapi ringkasan data toko belum ikut terkirim.**\n\nBuka halaman AI Copilot langsung di aplikasi agar data toko ikut dianalisa — tidak ada credit yang terpotong.',
          chips: chipSuggestions(),
          costCredits: 0,
        });
      }
  
      /* --- (e) Layer 3 candidate ------------------------------------------- */
      if (body.allowLlm === false) {
        return respond({
          source: 'RULE_ENGINE',
          intent: 'UNKNOWN',
          title: 'Belum paham pertanyaannya',
          markdown:
            '**Saya belum menangkap maksud pertanyaannya.**\n\nCoba salah satu pertanyaan cepat di bawah — semuanya gratis dan langsung dijawab dari data toko Anda.',
          chips: chipSuggestions(),
          costCredits: 0,
        });
      }
  
      if (wallet.balance <= 0) {
        // "Kuota habis" dan "paket Anda memang tidak termasuk AI" menuntut
        // tindakan yang berbeda — yang satu menunggu awal bulan, yang satu
        // harus naik paket. Menyamakan pesannya membuat merchant menunggu
        // sesuatu yang tidak akan pernah datang.
        const tanpaJatah = wallet.monthlyGrant === 0;

        return respond(
          {
            source: 'PAYWALL',
            intent: parsed.intent,
            title: tanpaJatah ? 'Paket Anda belum termasuk AI' : 'Butuh 1 AI Credit',
            markdown: tanpaJatah
              ? '**Pertanyaan ini butuh analisa AI generatif**, dan paket langganan Anda belum mencakupnya.\n\nPertanyaan seputar stok, omset, pelanggan, denah, dan staf tetap **gratis tanpa batas** lewat tombol cepat di atas.'
              : '**Pertanyaan ini butuh analisa AI generatif.**\n\nJatah AI Credit bulan ini sudah habis. Pertanyaan seputar stok, omset, pelanggan, denah, dan staf tetap **gratis tanpa batas** lewat tombol cepat di atas.',
            chips: chipSuggestions(),
            costCredits: 0,
          },
          {
            paywall: {
              title: tanpaJatah ? 'Paket Anda belum termasuk AI' : 'Butuh 1 AI Credit',
              message: tanpaJatah
                ? 'Analisa bebas (strategi, ide promo, pertanyaan terbuka) memakai 1 AI Credit per pertanyaan. Paket Anda belum mendapat jatah bulanan — tingkatkan paket, atau beli kredit tambahan sekali pakai.'
                : `Analisa bebas (strategi, ide promo, pertanyaan terbuka) memakai 1 AI Credit per pertanyaan. Sisa credit Anda 0 dari ${wallet.monthlyGrant} bulan ini.`,
              ctaLabel: 'Beli Paket Add-on',
              addOnPriceIdr: ADDON_PRICE_IDR,
              addOnCredits: ADDON_CREDITS,
            },
          }
        );
      }
  
      const llm = getLlmConfig();
      if (!llm) {
        // Not configured is not the merchant's fault — never bill for a call that
        // could not be made.
        return respond({
          source: 'RULE_ENGINE',
          intent: parsed.intent,
          title: 'Analisa AI belum aktif',
          markdown:
            '**Modul AI generatif belum dikonfigurasi di server ini** (kunci API penyedia AI belum diisi), jadi pertanyaan terbuka belum bisa dijawab.\n\nCredit Anda **tidak dipotong**. Semua analisa data toko di bawah ini tetap berjalan normal.',
          chips: chipSuggestions(),
          costCredits: 0,
        });
      }
  
      if (!(await pakaiKredit(svc.db, merchantId, ctx.businessId))) {
        return respond({
          source: 'PAYWALL',
          intent: parsed.intent,
          title: 'Butuh 1 AI Credit',
          markdown: '**Jatah AI Credit sudah habis.**',
          chips: chipSuggestions(),
          costCredits: 0,
        });
      }
  
      // Only aggregates and insight digests cross the wire. Raw transaction rows,
      // customer phone numbers and staff records never leave the merchant.
      const insightDigest = (body.insights ?? []).slice(0, 6).map((i) => ({
        category: i.category,
        priority: i.priority,
        title: i.title,
        summary: i.summary,
        metric: i.metricLabel,
      }));
  
      /*
       * The prompt states the tenant scope explicitly. The data handed over is
       * already partitioned by businessId before it reaches this function — this
       * is belt-and-braces so the model cannot be talked into speculating about
       * the merchant's other businesses, and so its answer names the unit it is
       * actually reasoning about.
       */
      const roleBrief: Record<string, string> = {
        ADMIN: 'pemilik/admin — boleh membahas margin, HPP, dan angka finansial detail',
        MANAGER: 'manajer operasional — fokus ke stok, staf, jadwal, dan performa harian',
        CASHIER:
          'kasir — jawab ringkas dan operasional; JANGAN membahas margin, HPP, gaji, atau data finansial sensitif, arahkan ke pemilik/manajer bila ditanya',
      };
      const role = ctx.userRole || 'ADMIN';
  
      const systemInstruction = `Anda adalah New Hope Copilot, konsultan bisnis untuk pemilik toko/UMKM Indonesia.
  
  KONTEKS TENANT (WAJIB DIPATUHI):
  - ID unit bisnis  : ${ctx.businessId}
  - Nama usaha      : ${ctx.storeName}
  - Sektor usaha    : ${ctx.businessSector}
  - Peran penanya   : ${role} (${roleBrief[role] || roleBrief.ADMIN})
  
  BATAS DATA:
  - Seluruh data di bawah HANYA milik unit bisnis ${ctx.businessId}.
  - Merchant ini mungkin menjalankan usaha lain di akun yang sama. Anda TIDAK memiliki datanya dan DILARANG menyebut, membandingkan, atau menyimpulkan apa pun tentang unit bisnis lain — meskipun diminta. Jika ditanya, jawab bahwa data usaha lain harus dibuka dari unit bisnis tersebut.
  - Istilah untuk slot/tempat pada usaha ini adalah "${ctx.slotNoun}".
  
  ATURAN JAWABAN:
  1. Bahasa Indonesia yang hangat, ringkas, dan praktis.
  2. Setiap angka yang Anda sebut HARUS berasal dari data JSON di bawah. Dilarang mengarang angka.
  3. Jika data tidak cukup, katakan terus terang apa yang kurang — jangan menebak.
  4. Sesuaikan kedalaman jawaban dengan peran penanya di atas.
  5. Tutup dengan 1-2 langkah konkret yang bisa dikerjakan hari ini.
  6. Format markdown: **tebal** untuk penekanan, "- " untuk poin.
  
  ASAL DATA: ${
        dataSource === 'DATABASE'
          ? 'database pusat — angka yang sama persis dengan yang dilihat tim support di back-office.'
          : 'perangkat kasir yang belum tersinkronisasi. Boleh dipakai menjawab, tapi jika penanya mempertanyakan selisih angka, sebutkan bahwa data ini belum disinkronkan ke pusat.'
      }
  ${
        // Bidang yang belum punya tabel harus disebut apa adanya. Tanpa baris ini
        // model akan melaporkan "0 pelanggan" sebagai fakta, padahal artinya
        // "belum ada tabelnya".
        Object.entries(provenance)
          .filter(([, v]) => v === 'UNAVAILABLE')
          .map(([k]) => k).length > 0
          ? `BIDANG TANPA DATA: ${Object.entries(provenance)
              .filter(([, v]) => v === 'UNAVAILABLE')
              .map(([k]) => k)
              .join(', ')} — nilainya 0 karena BELUM TERSEDIA, bukan karena benar-benar nol. Jangan menyimpulkan apa pun dari angka nol tersebut.`
          : ''
      }
  
  Ringkasan agregat unit bisnis ini: ${JSON.stringify(aggregates ?? {})}
  Insight batch semalam: ${JSON.stringify(insightDigest)}`;
  
      try {
        const result = await callLlm({
          system: systemInstruction,
          user: queryText || 'Beri saya ringkasan kondisi toko.',
          maxTokens: 1200,
        });
  
        return respond(
          {
            source: 'LLM',
            intent: parsed.intent,
            title: 'Analisa AI Generatif',
            markdown: result.text || 'Model tidak mengembalikan jawaban.',
            chips: chipSuggestions(),
            costCredits: 1,
          },
          {},
          { promptTokens: result.promptTokens, completionTokens: result.completionTokens }
        );
      } catch (llmErr: any) {
        await kembalikanKredit(svc.db, merchantId, ctx.businessId);
        console.error('[SmartAssistant] LLM call failed, credit refunded:', llmErr?.message);
        return respond({
          source: 'ERROR',
          intent: parsed.intent,
          title: 'Analisa AI gagal',
          markdown:
            '**Gagal menghubungi layanan AI.** Credit Anda sudah dikembalikan, jadi tidak ada yang terpotong. Silakan coba lagi sebentar lagi.',
          chips: chipSuggestions(),
          costCredits: 0,
        });
      }
    } catch (error: any) {
      console.error('[SmartAssistant] query handler failed:', error);
      const latencyMs = Date.now() - startedAt;
      res.status(500).json({
        ok: false,
        answer: {
          source: 'ERROR',
          intent: 'UNKNOWN',
          title: 'Terjadi kesalahan',
          markdown: '**Maaf, terjadi kesalahan internal saat memproses pertanyaan Anda.**',
          costCredits: 0,
          latencyMs,
        },
        credits: wallet,
      });
    }
  });
  
  app.get('/api/v1/assistant/credits', async (req, res) => {
    try {
      const merchantId =
        (req.query.merchantId as string) || (req.headers['x-tenant-id'] as string) || 'tenant-default';
      const businessId = (req.query.businessId as string) || undefined;
      res.json({ ok: true, credits: await ambilDompet(svc.db, merchantId, businessId) });
    } catch {
      res.status(500).json({ ok: false, error: 'Gagal membaca sisa AI Credit.' });
    }
  });
  
  app.post('/api/v1/assistant/credits/topup', async (req, res) => {
    try {
      const { merchantId = 'tenant-default', credits = ADDON_CREDITS, businessId } = req.body || {};
      const amount = Math.max(1, Math.min(500, Math.floor(Number(credits) || ADDON_CREDITS)));
      // Penambahan dilakukan di SQL, bukan dengan mengubah objek hasil baca:
      // dua pembelian bersamaan pada jalur baca-lalu-tulis akan saling
      // menimpa, dan salah satunya hilang tanpa jejak.
      const wallet = await tambahKredit(svc.db, merchantId, amount, businessId);
      res.json({
        ok: true,
        credits: wallet,
        message: `${amount} AI Credit berhasil ditambahkan. Sisa credit sekarang ${wallet.balance}.`,
      });
    } catch {
      res.status(500).json({ ok: false, error: 'Gagal menambah AI Credit.' });
    }
  });
  
  app.get('/api/v1/assistant/quick-chips', (_req, res) => {
    res.json({ ok: true, chips: QUICK_CHIPS });
  });
  
  /** The proof that the cost-control objective is actually being met. */
  /** Bukti bahwa target kendali biaya benar-benar tercapai. */
  app.get('/api/v1/assistant/audit', async (req, res) => {
    try {
      const merchantId =
        (req.query.merchantId as string) || (req.headers['x-tenant-id'] as string) || 'tenant-default';
      const r = await ringkasanAudit(svc.db, merchantId, Number(req.query.limit) || 100, (req.query.businessId as string) || undefined);
      res.json({
        ok: true,
        logs: r.logs,
        summary: {
          total: r.total,
          byCostSource: r.byCostSource,
          creditsSpent: r.creditsSpent,
          zeroCostShare: r.zeroCostShare,
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
        },
      });
    } catch (err) {
      console.error('[ai] audit gagal:', (err as Error).message);
      res.status(500).json({ ok: false, error: 'Gagal membaca audit log.' });
    }
  });
    const llm = getLlmConfig();
    console.log(
      llm
        ? `[ai] Layer 3 aktif — ${LLM_PROVIDER_LABEL}, model "${llm.model}", timeout ${LLM_TIMEOUT_MS / 1000}s.`
        : '[ai] Layer 3 NONAKTIF — DEEPSEEK_API_KEY kosong. Semua jawaban deterministik, tidak ada credit terpotong.'
    );
  },
});
