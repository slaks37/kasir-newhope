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
 * AKSES DATA. Snapshot server dibaca lewat private contract views setelah
 * kepemilikan usaha diverifikasi, lalu dihitung dengan reportAggregates yang
 * juga dipakai di browser. Raw POS tables tidak diberi grant ke svc_ai.
 */

import express from 'express';
import type { Db } from '../shared/db';
import { getLlmConfig, callLlm, LLM_PROVIDER_LABEL, LLM_TIMEOUT_MS } from './llm';
import { buildAggregatesFromDb, mergeWithClient } from './merchantData';
import { ambilDompet, reserveMemberCredit, kembalikanKredit, tambahKredit, catatAudit, ringkasanAudit } from './wallet';
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
import { canAccessBusiness, trustedPrincipal } from '../shared/auth';
import { BillingError } from '../billing/engine';
import { ownerOutletIntelligence } from './groupData';
import { computeDailyBrief } from './dailyBrief';
import { paidSystem, redactQuestion, PAID_DATA_CONSENT } from './paidPrivacy';
import { assertAiAvailable } from './entitlement';

export function registerAssistantRoutes(app: express.Express, database: Db) {
  // Express 4 does not forward rejected async route promises automatically.
  const route = {
    get: (path: string, handler: express.RequestHandler) => app.get(path, (req, res, next) => Promise.resolve(handler(req,res,next)).catch(next)),
    post: (path: string, handler: express.RequestHandler) => app.post(path, (req, res, next) => Promise.resolve(handler(req,res,next)).catch(next)),
  };
    const svc = { db: database };
    // `svc` bukan `ctx`: di dalam handler, `ctx` sudah dipakai untuk konteks
    // tenant (businessId, sektor, peran). Dua hal berbeda dengan nama sama
    // adalah cara paling mudah menulis bug yang lolos type-check.
    const db = () => Promise.resolve(svc.db);

  const ADDON_PRICE_IDR = 49000;
  const ADDON_CREDITS = 50;
  route.get('/api/v1/assistant/daily-brief',async(req,res)=>{
    const principal=trustedPrincipal(req);if(!principal)return res.status(401).json({ok:false,error:'AUTHENTICATION_REQUIRED'});
    try {return res.json({ok:true,brief:await computeDailyBrief(svc.db,principal,String(req.query.businessId||''))});}
    catch{return res.status(503).json({ok:false,error:'BRIEF_UNAVAILABLE'});}
  });
  route.get('/api/v1/assistant/group',async(req,res)=>{
    const principal=trustedPrincipal(req);
    if(!principal)return res.status(401).json({ok:false,error:'AUTHENTICATION_REQUIRED'});
    try {return res.json({ok:true,outlets:await ownerOutletIntelligence(svc.db,principal),dataSource:'DATABASE',period:'30 hari lengkap vs 30 hari sebelumnya · WIB'});}
    catch {return res.status(403).json({ok:false,error:'GROUP_BI_NOT_AVAILABLE'});}
  });

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

  async function requireBusiness(req: express.Request, res: express.Response, businessId: string): Promise<boolean> {
    const principal = trustedPrincipal(req);
    if (!principal || principal.subject === 'local-development') {
      res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
      return false;
    }
    if (!businessId || !(await canAccessBusiness(svc.db, principal, businessId))) {
      res.status(403).json({ ok: false, error: 'FORBIDDEN' });
      return false;
    }
    const owner = await svc.db.query('SELECT tenant_id FROM internal.merchants WHERE external_ref=$1',[businessId]);
    try {
      await assertAiAvailable(svc.db,owner.rows[0]?.tenant_id);
    } catch(error) {
      res.status(error instanceof BillingError ? error.status : 503).json({ok:false,error:error instanceof BillingError ? error.message : 'ENTITLEMENT_UNAVAILABLE'});
      return false;
    }
    return true;
  }

  /**
   * POST /api/v1/assistant/query
   *
   * Order of operations is the whole cost-control story:
   *   quick-chip bypass -> intent parse -> deterministic answer (Rp 0)
   *   -> only then credits -> only then the model.
   */
  route.post('/api/v1/assistant/query', async (req, res) => {
    const startedAt = Date.now();
    const body = (req.body || {}) as AssistantQueryRequest;
    const verifiedPrincipal = trustedPrincipal(req);
    if (!verifiedPrincipal || verifiedPrincipal.subject === 'local-development') return res.status(401).json({ok:false,error:'AUTHENTICATION_REQUIRED'});
    const merchantId = verifiedPrincipal.subject;
    if (typeof body.query !== 'string' || body.query.length > 2000) return res.status(400).json({ok:false,error:'QUERY_MAX_2000_CHARACTERS'});
    const queryText = body.query.trim();

    /*
     * Tenant scope is resolved FIRST — before the responder, before parsing,
     * before any credit decision. `businessId` is the partition key the client
     * computed; it identifies WHICH of the merchant's businesses this question is
     * about and is recorded on every new audit row. Business IDs and names
     * never enter the paid model's system prompt.
     */
    const ctx = {
      businessId:
        body.storeContext?.businessId || '',
      storeName: body.storeContext?.storeName || 'Toko Anda',
      businessSector: body.storeContext?.businessSector || 'FNB',
      slotNoun: body.storeContext?.slotNoun || 'Meja',
      userRole: 'ADMIN' as const, // canAccessBusiness proves ownership; never trust client role
    };

    if (!(await requireBusiness(req, res, ctx.businessId))) return;
    // One persistent wallet shared by all businesses owned by this verified member.
    let wallet:AiCreditWallet|undefined;
    try {wallet=await ambilDompet(svc.db,merchantId,ctx.businessId);}
    catch { /* Zero-credit responses still work; paid calls fail closed below. */ }

    const respond = async (
      answer: AssistantAnswer,
      extra: Partial<AssistantQueryResponse> = {},
      usage?: { promptTokens: number; completionTokens: number }
    ) => {
      const latencyMs = Date.now() - startedAt;
      answer.latencyMs = latencyMs;
      // Serverless runtimes may stop immediately after res.json; finish audit first.
      await catatAudit(svc.db, {
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
        parsed = { intent: body.intent, confidence: 1, entities: parseIntent(queryText).entities, matchedKeywords: ['quick-chip'] };
      } else {
        parsed = parseIntent(queryText);
      }
      if(parsed.entities.clarification)return respond({source:'RULE_ENGINE',intent:parsed.intent,title:'Perjelas periode',markdown:parsed.entities.clarification,costCredits:0});

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
        const fromDb = await buildAggregatesFromDb(database, ctx.businessId, verifiedPrincipal, parsed.entities);
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

      const actionPlan = body.purpose === 'ACTION_PLAN' && body.allowLlm === true && body.paidDataConsent === PAID_DATA_CONSENT;
      if (knownIntent && aggregates && !actionPlan) {
        const answer = resolveIntentFromAggregates(parsed, aggregates, body.insights ?? [], ctx);
        if (answer) {
          answer.costCredits = 0;
          // A database aggregate does not make device-generated insight cards
          // authoritative. Mark mixed answers, including local-only counters.
          const localFields: Partial<Record<IntentName, string[]>> = {
            GET_CHURN_CUSTOMERS: ['customerCounts'], GET_LOYAL_CUSTOMERS: ['customerCounts'],
            GET_TABLE_STATUS: ['slotsOccupied', 'slotsTotal'], GET_ATTENDANCE: ['staffOnShift'],
          };
          const deviceInsights = Array.isArray(body.insights) && body.insights.length > 0 &&
            (answer.source === 'BATCH_INSIGHT' || parsed.intent === 'GET_PROFIT_MARGIN');
          const deviceCounters = (localFields[parsed.intent] ?? []).some(key => provenance[key] === 'CLIENT');
          const answerSource = dataSource === 'DATABASE' && (deviceInsights || deviceCounters) ? 'MIXED' : dataSource;
          return respond(answer, { dataSource: answerSource,
            provenance: deviceInsights ? { ...provenance, insights: 'CLIENT' } : provenance });
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
      if (body.allowLlm !== true || body.paidDataConsent !== PAID_DATA_CONSENT) {
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

      if (!wallet) return respond({source:'ERROR',intent:parsed.intent,title:'Dompet perlu diperiksa',
        markdown:'Dompet kredit belum tersedia atau perlu rekonsiliasi. Analisis tanpa token tetap dapat digunakan. Tidak ada panggilan DeepSeek.',costCredits:0});
      if (wallet.balance <= 0) {
        return respond(
          {
            source: 'PAYWALL',
            intent: parsed.intent,
            title: 'Butuh 1 AI Credit',
            markdown:
              '**Pertanyaan ini butuh analisa AI generatif.**\n\nJatah AI Credit bulan ini sudah habis. Pertanyaan seputar stok, omset, pelanggan, denah, dan staf tetap **gratis tanpa batas** lewat tombol cepat di atas.',
            chips: chipSuggestions(),
            costCredits: 0,
          },
          {
            paywall: {
              title: 'Butuh 1 AI Credit',
              message: `Analisa bebas (strategi, ide promo, pertanyaan terbuka) memakai 1 AI Credit per pertanyaan. Sisa credit Anda 0 dari ${wallet.monthlyGrant} bulan ini.`,
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

      if (dataSource !== 'DATABASE' || !aggregates) return respond({
        source:'ERROR', intent:parsed.intent, title:'Data pusat belum tersedia',
        markdown:'Analisis berbayar memerlukan data pusat terverifikasi. Kredit tidak dipotong.',costCredits:0,
      });
      const reservation=await reserveMemberCredit(svc.db, merchantId, ctx.businessId);
      if (!reservation) {
        return respond({
          source: 'PAYWALL',
          intent: parsed.intent,
          title: 'Butuh 1 AI Credit',
          markdown: '**Jatah AI Credit sudah habis.**',
          chips: chipSuggestions(),
          costCredits: 0,
        });
      }

      const systemInstruction = paidSystem(merchantId, aggregates!, actionPlan);

      try {
        const result = await callLlm({
          system: systemInstruction,
          user: redactQuestion(queryText || 'Beri saya ringkasan kondisi toko.'),
          maxTokens: 1200,
        });

        return respond(
          {
            source: 'LLM',
            intent: parsed.intent,
            title: actionPlan ? 'Draft Rencana • Perlu Persetujuan Owner' : 'Analisa AI Generatif',
            markdown: result.text || 'Model tidak mengembalikan jawaban.',
            chips: chipSuggestions(),
            costCredits: 1,
          },
          { dataSource, provenance, credits: await ambilDompet(svc.db,merchantId,ctx.businessId) },
          { promptTokens: result.promptTokens, completionTokens: result.completionTokens }
        );
      } catch (llmErr: any) {
        await kembalikanKredit(svc.db, merchantId, ctx.businessId,reservation.periodResetAt);
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

  route.get('/api/v1/assistant/credits', async (req, res) => {
    try {
      const merchantId = trustedPrincipal(req)?.subject || '';
      const businessId = (req.query.businessId as string) || undefined;
      if (!(await requireBusiness(req, res, businessId || ''))) return;
      res.json({ ok: true, credits: await ambilDompet(svc.db, merchantId, businessId) });
    } catch {
      res.status(500).json({ ok: false, error: 'Gagal membaca sisa AI Credit.' });
    }
  });

  route.post('/api/v1/assistant/credits/topup', async (req, res) => {
    try {
      const { credits = ADDON_CREDITS, businessId } = req.body || {};
      if (!(await requireBusiness(req, res, String(businessId || '')))) return;
      const secret = process.env.AI_CREDIT_TOPUP_SECRET;
      const supplied = String(req.headers['x-ai-topup-secret'] || '');
      if (!secret || supplied !== secret) {
        return res.status(403).json({ ok: false, error: 'PAYMENT_PROOF_REQUIRED' });
      }
      const amount = Math.max(1, Math.min(500, Math.floor(Number(credits) || ADDON_CREDITS)));
      // tambahKredit memanggil fungsi database yang menuliskan TOPUP ke
      // immutable ledger dalam transaksi yang sama dengan perubahan saldo.
      const wallet = await tambahKredit(svc.db, trustedPrincipal(req)!.subject, amount, businessId);
      res.json({
        ok: true,
        credits: wallet,
        message: `${amount} AI Credit berhasil ditambahkan. Sisa credit sekarang ${wallet.balance}.`,
      });
    } catch {
      res.status(500).json({ ok: false, error: 'Gagal menambah AI Credit.' });
    }
  });

  route.get('/api/v1/assistant/quick-chips', (_req, res) => {
    res.json({ ok: true, chips: QUICK_CHIPS });
  });

  /** The proof that the cost-control objective is actually being met. */
  /** Bukti bahwa target kendali biaya benar-benar tercapai. */
  route.get('/api/v1/assistant/audit', async (req, res) => {
    try {
      const merchantId = trustedPrincipal(req)?.subject || '';
      const businessId = (req.query.businessId as string) || '';
      if (!(await requireBusiness(req, res, businessId))) return;
      const r = await ringkasanAudit(svc.db, merchantId, Number(req.query.limit) || 100, businessId);
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
        ? `[ai] Layer 3 aktif — ${llm.provider || LLM_PROVIDER_LABEL}, model "${llm.model}", timeout ${LLM_TIMEOUT_MS / 1000}s.`
        : '[ai] Layer 3 NONAKTIF — Kunci API LLM (AGNES_API_KEY / DEEPSEEK_API_KEY) kosong. Semua jawaban deterministik, tidak ada credit terpotong.'
    );
}
