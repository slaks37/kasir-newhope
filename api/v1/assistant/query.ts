import pg from 'pg';

type VercelRequest = any;
type VercelResponse = any;

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: parseInt(process.env.PGPOOL_MAX || '5', 10),
    });
  }
  return pool;
}

/** Keyword-based intent matching — deterministic, free. */
function matchIntent(q: string): { intent: string; markdown: string; title: string } | null {
  if (/omzet|penjualan|pendapatan|revenue|pemasukan/.test(q)) {
    return { intent: 'REVENUE_ANALYSIS', title: 'Analisa Omzet', markdown: '__NEEDS_DATA__' };
  }
  if (/stok|menipis|habis|restok|inventori/.test(q)) {
    return { intent: 'STOCK_MANAGEMENT', title: 'Manajemen Stok', markdown: '__NEEDS_DATA__' };
  }
  if (/promo|diskon|promosi|voucher/.test(q)) {
    return { intent: 'MARKETING_PROMO', title: 'Strategi Promo', markdown: '__NEEDS_DATA__' };
  }
  if (/pelanggan|customer|loyalti|setia/.test(q)) {
    return { intent: 'CRM_CHURN', title: 'Analisa Pelanggan', markdown: '__NEEDS_DATA__' };
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  const body = req.body ?? {};
  const merchantId: string = body.merchantId || 'usr-1_FNB';
  const queryText: string = (body.query || '').trim();
  const q = queryText.toLowerCase();
  const ctx = body.storeContext ?? {};
  const storeName: string = ctx.storeName || body.storeName || 'Toko Anda';
  const businessSector: string = ctx.businessSector || 'FNB';

  const db = getPool();

  // Whether the numbers below actually came out of the database. A reply built
  // on defaults must not claim otherwise: "omzet Rp 0" reads as a quiet shop,
  // and that is the one answer a broken query must never be able to give.
  let dataSource: 'DATABASE' | 'UNAVAILABLE' = 'UNAVAILABLE';

  /** Helper: build a proper AssistantAnswer-shaped response */
  const answer = (
    markdown: string,
    source: string,
    title: string,
    intent = 'UNKNOWN',
    costCredits = 0
  ) =>
    res.status(200).json({
      ok: true,
      answer: { markdown, source, title, intent, costCredits, chips: [] },
      credits: { balance: 30, monthlyGrant: 30, usedThisMonth: 0 },
      dataSource,
    });

  try {
    // Fetch live metrics
    let revenueSum = 0;
    let orderCount = 0;
    let topProducts: string[] = [];
    let lapsedCustomers: Array<{ name: string; tier: string; hari: number; belanja: string }> = [];

    try {
      // merchantId arrives as a business unit key (`usr-1_FNB`) or an account
      // ref (`usr-1`), never as the tenant UUID the tables are keyed by. This
      // mirrors the lookup order in services/shared/identity.ts: business unit
      // first, then owner — and only when that owner has exactly one unit, since
      // guessing between a café and a laundry silently reports the wrong shop.
      const tenant = await db.query(
        `SELECT merchant_id FROM contract.merchant_directory
          WHERE business_id = $1
             OR (owner_user_ref = $1 AND (SELECT COUNT(*) FROM contract.merchant_directory
                                           WHERE owner_user_ref = $1) = 1)
          LIMIT 1`,
        [merchantId]
      );

      if (!tenant.rows.length) {
        // Not an error: a merchant that has never synced simply has no rows yet.
        console.warn(`[query] merchant belum tersinkronisasi: ${merchantId}`);
      } else {
        const tenantId = tenant.rows[0].merchant_id;

        const stats = await db.query(
          `SELECT COUNT(*)::int AS orders, COALESCE(SUM(total_amount), 0)::numeric AS total
             FROM pos.transactions
            WHERE tenant_id = $1
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
            WHERE t.tenant_id = $1
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
            WHERE merchant_id = $1 AND days_since_last_transaction > 14
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

    // --- Deterministic path (gratis) ---
    const matched = matchIntent(q);

    if (matched) {
      let markdown = '';
      if (matched.intent === 'REVENUE_ANALYSIS') {
        const avg = orderCount > 0 ? Math.round(revenueSum / orderCount) : 0;
        markdown =
          dataSource !== 'DATABASE'
            ? belumAdaData
            : `**Omzet 30 Hari Terakhir — ${storeName}**\n\n` +
              `- **Total Omzet:** ${fmtRp(revenueSum)}\n` +
              `- **Jumlah Transaksi:** ${orderCount} struk\n` +
              `- **Rata-rata per Transaksi:** ${fmtRp(avg)}\n\n` +
              `💡 Dorong penjualan produk bundling atau up-selling untuk meningkatkan nilai rata-rata transaksi.`;
      } else if (matched.intent === 'STOCK_MANAGEMENT') {
        markdown =
          dataSource !== 'DATABASE'
            ? belumAdaData
            : `**Status Stok — ${storeName}**\n\n` +
              `Produk terlaris minggu ini: ${topProducts.join(', ') || 'belum ada data'}\n\n` +
              `💡 Restok produk-produk terlaris sebelum akhir pekan untuk menghindari kehabisan stok saat lonjakan transaksi.`;
      } else if (matched.intent === 'MARKETING_PROMO') {
        markdown =
          `**Ide Promo untuk ${storeName}**\n\n` +
          `- **Happy Hour:** Diskon 10-15% pukul 14:00–16:00\n` +
          `- **Bundle Hemat:** Paket makanan + minuman lebih hemat Rp 5.000\n` +
          `- **Loyalty:** Poin ganda untuk pembayaran QRIS`;
      } else if (matched.intent === 'CRM_CHURN') {
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

    // --- LLM path (berbayar) ---
    const systemPrompt =
      `Anda adalah New Hope Copilot, asisten bisnis untuk pemilik UMKM Indonesia.\n` +
      `Toko: ${storeName} | Sektor: ${businessSector}\n` +
      `Data terkini: ${dataCtx}\n\n` +
      `Aturan: jawab dalam Bahasa Indonesia yang hangat dan praktis. ` +
      `Setiap angka HARUS dari data di atas. Tutup dengan 1-2 langkah konkret hari ini. ` +
      `Format: **tebal** untuk penekanan, "- " untuk poin.`;

    try {
      const llmText = await callDeepSeek(systemPrompt, queryText || 'Beri ringkasan kondisi toko.');
      return answer(llmText, 'LLM', 'Analisa AI Generatif', 'UNKNOWN', 1);
    } catch (llmErr: any) {
      console.error('[query] LLM error:', llmErr?.message);
      return answer(
        `**Gagal menghubungi layanan AI.** Silakan coba lagi.\n\n${dataCtx}`,
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
