import pg from 'pg';
import { resolveTenantId } from '../../_lib/tenant.js';
import { jagaModul } from '../../_lib/entitlementGuard.js';
import { rutekan } from '../../../src/lib/assistant/router.js';
import type { IntentName } from '../../../src/lib/assistant/types.js';

type VercelRequest = any;
type VercelResponse = any;

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL || '';
    const lokal = /@(127\.0\.0\.1|localhost)|host=\//.test(url);
    pool = new pg.Pool({
      connectionString: url,
      ssl: lokal ? undefined : { rejectUnauthorized: false },
      max: Number(process.env.PGPOOL_MAX || 2),
    });
  }
  return pool;
}

/**
 * Pencocokan intent berbasis kata kunci — deterministik, gratis.
 *
 * NAMA INTENT-NYA DARI IntentName, bukan kosakata sendiri.
 *
 * Berkas ini dulu menghasilkan 'REVENUE_ANALYSIS', 'STOCK_MANAGEMENT',
 * 'MARKETING_PROMO' — empat nama yang tidak ada di tipe IntentName yang dipakai
 * seluruh sisa sistem. Satu konsep dengan dua kosakata berarti router tidak
 * bisa mengenali apa pun yang keluar dari sini, dan setiap penyatuan berikutnya
 * harus menerjemahkan lebih dulu.
 *
 * `confidence` diberikan di sini karena router memerlukannya. Nilainya
 * mencerminkan seberapa spesifik polanya, bukan tebakan.
 */
function matchIntent(
  q: string
): { intent: IntentName; title: string; confidence: number } | null {
  if (/omzet|penjualan|pendapatan|revenue|pemasukan/.test(q)) {
    return { intent: 'GET_REVENUE_SUMMARY', title: 'Analisa Omzet', confidence: 0.8 };
  }
  if (/stok|menipis|habis|restok|inventori/.test(q)) {
    return { intent: 'GET_STOCK_CRITICAL', title: 'Manajemen Stok', confidence: 0.8 };
  }
  if (/promo|diskon|promosi|voucher/.test(q)) {
    return { intent: 'GET_PROMO_LIST', title: 'Strategi Promo', confidence: 0.7 };
  }
  if (/pelanggan|customer|loyalti|setia/.test(q)) {
    return { intent: 'GET_CHURN_CUSTOMERS', title: 'Analisa Pelanggan', confidence: 0.75 };
  }
  return null;
}

/** Call DeepSeek LLM for open-ended questions. */
async function callDeepSeek(system: string, user: string): Promise<string> {
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) throw new Error('DEEPSEEK_API_KEY tidak dikonfigurasi');

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 800,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'Model tidak mengembalikan jawaban.';
}

interface Dompet {
  balance: number;
  monthlyGrant: number;
  usedThisMonth: number;
}

/** Awal bulan berikutnya, WIB — sama seperti services/ai/wallet.ts. */
function periodeBerikutnya(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/**
 * Dompet kredit merchant, dibuat bila belum ada dan disegarkan bila periodenya
 * lewat. Salinan perilaku services/ai/wallet.ts, dengan aturan yang sama:
 * jatah mengikuti paket, naik paket berlaku seketika, turun paket tidak
 * menarik saldo berjalan.
 *
 * Sebelumnya berkas ini tidak punya dompet sama sekali — ia menjawab dengan
 * `balance: 30` yang ditulis langsung di kode dan TIDAK PERNAH memotong apa
 * pun. Di produksi Vercel itu berarti kuota AI tidak terbatas untuk semua
 * merchant, berapa pun paketnya, dan setiap panggilan LLM tetap ditagihkan
 * kepada kami.
 */
async function ambilDompet(db: pg.Pool, tenantId: string): Promise<Dompet | null> {
  const kuota = await db.query(
    `SELECT ai_quota_effective FROM contract.merchant_entitlements WHERE business_id = $1`,
    [tenantId]
  );
  const jatah = Number(kuota.rows[0]?.ai_quota_effective ?? 0);

  try {
    const dibuat = await db.query(
      `INSERT INTO ai.merchant_ai_credits
         (business_id, balance, monthly_grant, used_this_month, period_reset_at)
       VALUES ($1, $2, $2, 0, $3::timestamptz)
       ON CONFLICT (business_id) DO NOTHING
       RETURNING balance, monthly_grant, used_this_month`,
      [tenantId, jatah, periodeBerikutnya()]
    );
    if (dibuat.rows.length) {
      const r = dibuat.rows[0];
      return { balance: r.balance, monthlyGrant: r.monthly_grant, usedThisMonth: r.used_this_month };
    }

    const { rows } = await db.query(
      `UPDATE ai.merchant_ai_credits
          SET balance         = CASE
                                  WHEN period_reset_at <= CURRENT_TIMESTAMP THEN $3
                                  WHEN $3 > monthly_grant THEN GREATEST(balance, $3)
                                  ELSE balance
                                END,
              used_this_month = CASE WHEN period_reset_at <= CURRENT_TIMESTAMP
                                     THEN 0 ELSE used_this_month END,
              period_reset_at = CASE WHEN period_reset_at <= CURRENT_TIMESTAMP
                                     THEN $2::timestamptz ELSE period_reset_at END,
              monthly_grant   = $3,
              updated_at      = CURRENT_TIMESTAMP
        WHERE business_id = $1
        RETURNING balance, monthly_grant, used_this_month`,
      [tenantId, periodeBerikutnya(), jatah]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return { balance: r.balance, monthlyGrant: r.monthly_grant, usedThisMonth: r.used_this_month };
  } catch (err: any) {
    // FK ke tenants: merchant belum pernah tersinkronisasi. Bukan galat —
    // hanya belum ada apa pun untuk dibebani.
    if (err?.code === '23503') return null;
    console.error('[query] gagal menyiapkan dompet kredit:', err?.message);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  const body = req.body ?? {};

  /*
   * IDENTITAS WAJIB, TIDAK ADA BAWAAN.
   *
   * Baris ini dulu berbunyi `body.merchantId || 'usr-1_FNB'`. Permintaan tanpa
   * identitas apa pun karena itu dijawab SEBAGAI merchant usr-1: siapa pun yang
   * mengirim POST kosong ke endpoint ini membaca omzet, jumlah transaksi, dan
   * produk terlaris milik toko orang lain. Bawaannya kemungkinan besar sisa
   * masa pengembangan, dan tidak pernah dicabut.
   *
   * Namanya juga diperbaiki. Yang dikirim klien adalah kunci UNIT USAHA
   * (`usr-budi_FNB`), bukan merchant — dan sejak 0025 merchant adalah entitas
   * tersendiri yang berarti PEMILIK. `merchantId` tetap diterima supaya klien
   * yang sudah terlanjur ter-deploy tidak patah, tapi bukan lagi nama utamanya.
   */
  const businessId: string = String(body.businessId || body.merchantId || '').trim();
  const queryText: string = (body.query || '').trim();
  const q = queryText.toLowerCase();
  const ctx = body.storeContext ?? {};
  const storeName: string = ctx.storeName || body.storeName || 'Toko Anda';
  const businessSector: string = ctx.businessSector || 'FNB';

  if (!businessId) {
    return res.status(400).json({
      ok: false,
      error: 'BAD_REQUEST',
      detail: 'businessId wajib diisi.',
    });
  }

  const db = getPool();

  // Whether the numbers below actually came out of the database. A reply built
  // on defaults must not claim otherwise: "omzet Rp 0" reads as a quiet shop,
  // and that is the one answer a broken query must never be able to give.
  let dataSource: 'DATABASE' | 'UNAVAILABLE' = 'UNAVAILABLE';

  // Diisi saat merchant berhasil dikenali. Keduanya dipakai di luar blok
  // pengambilan metrik, jadi hidup di lingkup handler.
  let tenantId: string | null = null;
  let dompet: Dompet | null = null;

  /** Helper: build a proper AssistantAnswer-shaped response */
  const answer = (
    markdown: string,
    source: string,
    title: string,
    intent = 'UNKNOWN',
    costCredits = 0,
    extra: Record<string, unknown> = {}
  ) =>
    res.status(200).json({
      ok: true,
      answer: { markdown, source, title, intent, costCredits, chips: [] },
      // Saldo sungguhan. Sebelumnya di sini ada `{ balance: 30, monthlyGrant: 30 }`
      // yang ditulis langsung di kode: layar merchant selalu menampilkan 30
      // kredit tersisa, berapa pun paketnya dan berapa pun yang sudah dipakai.
      credits: dompet ?? { balance: 0, monthlyGrant: 0, usedThisMonth: 0 },
      dataSource,
      ...extra,
    });

  try {
    // Fetch live metrics
    let revenueSum = 0;
    let orderCount = 0;
    let topProducts: string[] = [];
    let lapsedCustomers: Array<{ name: string; tier: string; hari: number; belanja: string }> = [];

    try {
      // businessId arrives as a business unit key (`usr-budi_FNB`) or an
      // account ref (`usr-budi`), never as the UUID the tables are keyed by.
      tenantId = await resolveTenantId(db, businessId);

      if (!tenantId) {
        // Not an error: a merchant that has never synced simply has no rows yet.
        console.warn(`[query] unit usaha belum tersinkronisasi: ${businessId}`);
      } else {

        const stats = await db.query(
          `SELECT COUNT(*)::int AS orders, COALESCE(SUM(total_amount), 0)::numeric AS total
             FROM pos.transactions
            WHERE business_id = $1
              AND payment_status <> 'CANCELLED'
              AND created_at >= NOW() - INTERVAL '30 days'`,
          [tenantId]
        );
        orderCount = stats.rows[0]?.orders ?? 0;
        revenueSum = Number(stats.rows[0]?.total ?? 0);

        // Receipt lines live in transaction_items; pos.order_items has never
        // existed. product_name is snapshotted on the line, so no join to the
        // catalog is needed — and a renamed product keeps its old sales history.
        const prods = await db.query(
          `SELECT i.product_name AS name, SUM(i.quantity)::int AS qty
             FROM pos.transaction_items i
             JOIN pos.transactions t ON t.id = i.transaction_id
            WHERE t.business_id = $1
              AND t.payment_status <> 'CANCELLED'
              AND t.created_at >= NOW() - INTERVAL '7 days'
            GROUP BY i.product_name
            ORDER BY qty DESC
            LIMIT 3`,
          [tenantId]
        );
        topProducts = prods.rows.map((r: any) => `${r.name} (${r.qty}x)`);

        // Members who used to come and stopped. Excludes those who never
        // bought at all — a member registered yesterday is not churning.
        const lapsed = await db.query(
          `SELECT name, tier, days_since_last_transaction AS hari, lifetime_spent_recorded AS belanja
             FROM contract.customer_rfm
            WHERE business_id = $1 AND days_since_last_transaction > 14
            ORDER BY lifetime_spent_recorded DESC
            LIMIT 5`,
          [tenantId]
        );
        lapsedCustomers = lapsed.rows;

        dataSource = 'DATABASE';
      }
    } catch (dbErr: any) {
      // Never swallowed. A schema mistake here looks exactly like an empty
      // shop, and that is how the wrong column name survived unnoticed.
      console.error('[query] gagal membaca metrik toko:', dbErr?.message);
    }

    // Dompet disiapkan SESUDAH merchant dikenali dan SEBELUM jawaban apa pun
    // dikirim, supaya saldo yang ditampilkan di layar selalu yang terkini —
    // termasuk pada jawaban gratis, yang juga menampilkan sisa kredit.
    /*
     * MODUL AI HARUS DIBUKA PAKET, bukan sekadar kuotanya cukup.
     *
     * Kuota dan akses modul adalah dua hal berbeda, dan hanya kuota yang selama
     * ini diperiksa di sini. Sisi klien menyembunyikan tombolnya bila modulnya
     * tidak dibeli — dan penyembunyian di klien bisa dilewati siapa pun yang
     * menyunting bundel JavaScript, sementara setiap panggilan LLM yang lolos
     * tetap ditagihkan kepada kami.
     */
    if (tenantId) {
      const jaga = await jagaModul(db, tenantId, 'ai');
      if (!jaga.boleh) {
        return answer(
          'AI Copilot tidak termasuk paket Anda saat ini. Tingkatkan paket untuk memakainya.',
          'PAYWALL',
          'Fitur belum aktif',
          'MODUL_TIDAK_TERMASUK_PAKET',
          0
        );
      }
      dompet = await ambilDompet(db, tenantId);
    }

    const fmtRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
    const dataCtx =
      dataSource === 'DATABASE'
        ? `Omzet 30 hari: ${fmtRp(revenueSum)}, Transaksi: ${orderCount}, Produk terlaris minggu ini: ${topProducts.join(', ') || 'belum ada data'}.`
        : `Data toko belum tersedia di server. JANGAN menyebut angka apa pun.`;

    // Shown instead of a figure when the shop's data never arrived, so the
    // reader can tell "belum tersinkron" apart from "belum ada penjualan".
    const belumAdaData =
      `**Data toko belum tersedia di server.**\n\n` +
      `Transaksi ${storeName} belum selesai tersinkronisasi, jadi angkanya belum bisa ditampilkan di sini. ` +
      `Periksa indikator sinkronisasi di aplikasi kasir, lalu coba lagi.`;

    /* --- ROUTER: EMPAT PERTIMBANGAN, BUKAN SATU ANGKA -------------------
     *
     * Sebelum ini urutannya sederhana: kalau kata kuncinya cocok, jawab dengan
     * angka; kalau tidak, panggil model. Akibatnya "kenapa omzet saya turun?"
     * cocok dengan pola /omzet/ dan dijawab tabel omzet — benar secara
     * harfiah, dan sama sekali bukan jawaban atas pertanyaannya.
     *
     * rutekan() memisahkan izin, kemampuan menjawab dengan angka, ketersediaan
     * insight, dan kebutuhan penalaran menjadi empat pertimbangan yang berdiri
     * sendiri. Yang menentukan bukan seberapa yakin pencocok pola, melainkan
     * apakah pertanyaannya bisa dijawab tanpa menghubungkan beberapa fakta.
     */
    const matched = matchIntent(q);

    // Apakah batch semalam meninggalkan sesuatu yang bisa menjawab. Ditanyakan
    // SEBELUM merutekan, karena "ada insight" adalah salah satu pertimbangan.
    let insightTersedia: Map<string, any> = new Map();
    if (tenantId) {
      try {
        const { rows } = await db.query(
          `SELECT category, title, summary, metric_label, insight_date
             FROM ai.daily_merchant_insights
            WHERE business_id = $1 AND status = 'ACTIVE'
              AND insight_date >= CURRENT_DATE - 2`,
          [tenantId]
        );
        insightTersedia = new Map(rows.map((r: any) => [r.category, r]));
      } catch (e: any) {
        console.error('[query] gagal membaca insight batch:', e?.message);
      }
    }

    const rute = rutekan({
      parsed: {
        intent: matched?.intent ?? 'UNKNOWN',
        confidence: matched?.confidence ?? 0,
        entities: {},
        matchedKeywords: [],
      },
      pertanyaan: q,
      // Sampai di sini jagaModul sudah lolos, jadi modul AI pasti terbuka.
      modulTerbuka: ['ai'],
      adaInsightBatch: insightTersedia.size > 0,
    });

    /* --- LAPISAN 2: insight batch (gratis) ------------------------------ */
    //
    // Angkanya sudah dihitung semalam. Menjawab dari sini tidak memanggil model
    // dan tidak menagih kredit — dan jawabannya sama persis dengan kartu
    // insight yang dilihat merchant, jadi asisten tidak pernah menyebut angka
    // yang berbeda dari layarnya sendiri.
    if (rute.lapisan === 'ANALITIK' && rute.kategoriInsight) {
      const kartu = insightTersedia.get(rute.kategoriInsight);
      if (kartu) {
        const umurHari = Math.round(
          (Date.now() - new Date(kartu.insight_date).getTime()) / 86_400_000
        );
        const catatanUmur =
          umurHari >= 1
            ? `\n\n_Dihitung ${umurHari} hari lalu; angka hari ini bisa berbeda._`
            : '';
        return answer(
          `**${kartu.title}**\n\n${kartu.summary}\n\n\`${kartu.metric_label}\`${catatanUmur}`,
          'BATCH_INSIGHT',
          kartu.title,
          matched?.intent ?? 'UNKNOWN',
          0
        );
      }
    }

    /* --- LAPISAN 1: deterministik (gratis) ------------------------------ */
    //
    // Syaratnya "BUKAN penalaran", bukan "DETERMINISTIK". Dua alasan:
    //
    //   1. Inilah yang menahan pertanyaan "kenapa/sebaiknya/bagaimana caranya"
    //      supaya tidak dijawab tabel angka hanya karena kata kuncinya cocok.
    //   2. Pertanyaan berlapisan ANALITIK yang kartunya kebetulan belum ada
    //      harus jatuh ke sini, BUKAN ke model. Menuliskannya sebagai
    //      `=== 'DETERMINISTIK'` membuat pertanyaan stok dan pelanggan —
    //      selama ini gratis — mulai menagih kredit begitu batch semalam
    //      belum sempat berjalan.
    if (matched && rute.lapisan !== 'PENALARAN') {
      let markdown = '';
      if (matched.intent === 'GET_REVENUE_SUMMARY') {
        const avg = orderCount > 0 ? Math.round(revenueSum / orderCount) : 0;
        markdown =
          dataSource !== 'DATABASE'
            ? belumAdaData
            : `**Omzet 30 Hari Terakhir — ${storeName}**\n\n` +
              `- **Total Omzet:** ${fmtRp(revenueSum)}\n` +
              `- **Jumlah Transaksi:** ${orderCount} struk\n` +
              `- **Rata-rata per Transaksi:** ${fmtRp(avg)}\n\n` +
              `💡 Dorong penjualan produk bundling atau up-selling untuk meningkatkan nilai rata-rata transaksi.`;
      } else if (matched.intent === 'GET_STOCK_CRITICAL') {
        markdown =
          dataSource !== 'DATABASE'
            ? belumAdaData
            : `**Status Stok — ${storeName}**\n\n` +
              `Produk terlaris minggu ini: ${topProducts.join(', ') || 'belum ada data'}\n\n` +
              `💡 Restok produk-produk terlaris sebelum akhir pekan untuk menghindari kehabisan stok saat lonjakan transaksi.`;
      } else if (matched.intent === 'GET_PROMO_LIST') {
        markdown =
          `**Ide Promo untuk ${storeName}**\n\n` +
          `- **Happy Hour:** Diskon 10-15% pukul 14:00–16:00\n` +
          `- **Bundle Hemat:** Paket makanan + minuman lebih hemat Rp 5.000\n` +
          `- **Loyalty:** Poin ganda untuk pembayaran QRIS`;
      } else if (matched.intent === 'GET_CHURN_CUSTOMERS') {
        if (dataSource !== 'DATABASE') {
          markdown = belumAdaData;
        } else if (!lapsedCustomers.length) {
          markdown =
            `**Analisa Pelanggan — ${storeName}**\n\n` +
            `Tidak ada member yang lebih dari 14 hari tidak berkunjung. Retensinya sedang sehat.\n\n` +
            `💡 Pertahankan dengan poin ganda di hari sepi, biasanya Senin–Selasa.`;
        } else {
          markdown =
            `**Member yang Mulai Menjauh — ${storeName}**\n\n` +
            lapsedCustomers
              .map(
                (c) =>
                  `- **${c.name}** (${c.tier}) — ${c.hari} hari tidak datang, total belanja ${fmtRp(Number(c.belanja))}`
              )
              .join('\n') +
            `\n\n💡 Mulai dari yang total belanjanya paling besar: merekalah yang paling mahal kalau benar-benar hilang.`;
        }
      }

      return answer(markdown, 'RULE_ENGINE', matched.title, matched.intent, 0);
    }

    /* --- Jalur LLM: BERBAYAR ------------------------------------------- */
    //
    // Semua di atas gratis dan tanpa batas — dijawab dari data toko sendiri,
    // tanpa memanggil model. Yang dibatasi kuota hanyalah pertanyaan terbuka
    // yang benar-benar menimbulkan biaya LLM.

    if (!dompet) {
      // Merchant belum tersinkronisasi: tidak ada dompet untuk dibebani, dan
      // memberi panggilan LLM gratis kepada identitas yang tidak terikat
      // merchant mana pun berarti siapa pun bisa mengarang merchantId baru
      // untuk mendapat panggilan tanpa batas.
      return answer(
        '**Analisa AI belum bisa dipakai.**\n\nData toko Anda belum selesai tersinkronisasi ke server, jadi jatah AI belum bisa dihitung. Pertanyaan seputar omzet, stok, dan pelanggan tetap gratis lewat tombol cepat di atas.',
        'PAYWALL', 'Menunggu sinkronisasi', 'UNKNOWN', 0
      );
    }

    if (dompet.balance <= 0) {
      const tanpaJatah = dompet.monthlyGrant === 0;
      return answer(
        tanpaJatah
          ? '**Pertanyaan ini butuh analisa AI generatif**, dan paket langganan Anda belum mencakupnya.\n\nPertanyaan seputar omzet, stok, dan pelanggan tetap **gratis tanpa batas** lewat tombol cepat di atas.'
          : '**Pertanyaan ini butuh analisa AI generatif.**\n\nJatah AI bulan ini sudah habis. Pertanyaan seputar omzet, stok, dan pelanggan tetap **gratis tanpa batas** lewat tombol cepat di atas.',
        'PAYWALL',
        tanpaJatah ? 'Paket Anda belum termasuk AI' : 'Jatah AI bulan ini habis',
        'UNKNOWN',
        0,
        {
          paywall: {
            title: tanpaJatah ? 'Paket Anda belum termasuk AI' : 'Jatah AI bulan ini habis',
            message: tanpaJatah
              ? 'Paket Anda belum mendapat jatah AI bulanan. Tingkatkan paket, atau beli kredit tambahan sekali pakai.'
              : `Sisa kredit Anda 0 dari ${dompet.monthlyGrant} bulan ini.`,
            ctaLabel: 'Beli Kredit Tambahan',
          },
        }
      );
    }

    // Dipotong SEBELUM model dipanggil, lewat fungsi atomik yang sama dengan
    // ai-service. Memotong sesudahnya berarti dua request bersamaan pada kredit
    // terakhir sama-sama lolos — dan panggilan keduanya tetap ditagihkan.
    //
    // MESIN KEADAAN, bukan sekadar potong-lalu-kembalikan.
    //
    // Baris pertanyaan dibuat lebih dulu dalam keadaan RESERVED, baru
    // kreditnya dicadangkan terhadap baris itu. Kalau proses mati setelah model
    // menjawab tapi sebelum jawabannya tercatat, yang tertinggal bukan kredit
    // hilang tanpa jejak melainkan satu baris RESERVED yang bisa ditemukan dan
    // dikembalikan oleh ai.bersihkan_cadangan_menggantung().
    //
    // idempotencyKey mengikat percobaan ulang ke cadangan yang sama: jaringan
    // yang putus lalu dicoba lagi tidak menagih dua kali untuk satu jawaban.
    const idemKey =
      String(req.headers?.['x-idempotency-key'] ?? '').slice(0, 128) ||
      `${tenantId}:${queryText}`.slice(0, 128);

    const { rows: qRows } = await db.query(
      `INSERT INTO ai.ai_query_logs
         (id, business_id, query_text, resolved_intent, source, credits_charged,
          state, idempotency_key)
       VALUES (uuidv7(), $1, $2, 'PENDING', 'LLM', 1, 'RESERVED', $3)
       ON CONFLICT (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [tenantId, String(queryText).slice(0, 2000), idemKey]
    );

    // Tidak ada baris berarti pertanyaan yang sama sedang atau sudah diproses.
    // Menjawabnya dengan memotong kredit lagi adalah menagih dua kali.
    if (!qRows.length) {
      return answer(
        'Pertanyaan yang sama sedang diproses. Tunggu sebentar lalu muat ulang.',
        'PAYWALL', 'Sedang diproses', 'DUPLIKAT', 0
      );
    }
    const queryId = qRows[0].id;

    const terpakai = await db.query(
      `SELECT ai.cadangkan_kredit($1::uuid, $2::uuid, $3) AS ok`,
      [tenantId, queryId, idemKey]
    );
    if (terpakai.rows[0]?.ok !== true) {
      await db.query(`DELETE FROM ai.ai_query_logs WHERE id = $1 AND state = 'RESERVED'`, [queryId]);
      return answer(
        '**Jatah AI bulan ini sudah habis.**\n\nPertanyaan seputar omzet, stok, dan pelanggan tetap gratis lewat tombol cepat di atas.',
        'PAYWALL', 'Jatah AI bulan ini habis', 'UNKNOWN', 0
      );
    }
    dompet = { ...dompet, balance: dompet.balance - 1, usedThisMonth: dompet.usedThisMonth + 1 };

    const systemPrompt =
      `Anda adalah New Hope Copilot, asisten bisnis untuk pemilik UMKM Indonesia.\n` +
      `Toko: ${storeName} | Sektor: ${businessSector}\n` +
      `Data terkini: ${dataCtx}\n\n` +
      `Aturan: jawab dalam Bahasa Indonesia yang hangat dan praktis. ` +
      `Setiap angka HARUS dari data di atas. Tutup dengan 1-2 langkah konkret hari ini. ` +
      `Format: **tebal** untuk penekanan, "- " untuk poin.`;

    try {
      const llmText = await callDeepSeek(systemPrompt, queryText || 'Beri ringkasan kondisi toko.');
      // Cadangan diselesaikan HANYA setelah jawabannya benar-benar ada.
      await db.query(`SELECT ai.selesaikan_kredit($1::uuid)`, [queryId]);
      return answer(llmText, 'LLM', 'Analisa AI Generatif', 'UNKNOWN', 1);
    } catch (llmErr: any) {
      console.error('[query] LLM error:', llmErr?.message);

      // Kredit dikembalikan. Merchant tidak boleh membayar untuk panggilan yang
      // tidak pernah menghasilkan jawaban — itu kegagalan kami, bukan pemakaian.
      try {
        await db.query(`SELECT ai.kembalikan_kredit($1::uuid, $2)`,
          [queryId, 'Panggilan model gagal']);
        dompet = { ...dompet, balance: dompet.balance + 1, usedThisMonth: Math.max(0, dompet.usedThisMonth - 1) };
      } catch (refundErr: any) {
        console.error('[query] gagal mengembalikan kredit:', refundErr?.message);
      }

      return answer(
        `**Gagal menghubungi layanan AI.** Kredit Anda tidak terpotong. Silakan coba lagi.\n\n${dataCtx}`,
        'ERROR',
        'Gagal',
        'UNKNOWN',
        0
      );
    }
  } catch (err: any) {
    console.error('[query] handler error:', err);
    return res.status(500).json({
      ok: false,
      answer: {
        markdown: '**Maaf, terjadi kesalahan internal.** Silakan coba lagi.',
        source: 'ERROR',
        title: 'Kesalahan',
        intent: 'UNKNOWN',
        costCredits: 0,
      },
    });
  }
}
