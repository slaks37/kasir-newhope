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
      dataSource: 'DATABASE',
    });

  try {
    // Fetch live metrics
    let revenueSum = 0;
    let orderCount = 0;
    let topProducts: string[] = [];

    try {
      const stats = await db.query(
        `SELECT COUNT(*)::int as orders, COALESCE(SUM(total_amount), 0)::numeric as total
         FROM pos.transactions
         WHERE merchant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`,
        [merchantId]
      );
      if (stats.rows[0]?.orders > 0) {
        orderCount = stats.rows[0].orders;
        revenueSum = Number(stats.rows[0].total);
      }

      const prods = await db.query(
        `SELECT p.name, SUM(oi.quantity)::int as qty
         FROM pos.order_items oi
         JOIN pos.products p ON p.id = oi.product_id
         JOIN pos.transactions t ON t.id = oi.transaction_id
         WHERE t.merchant_id = $1 AND t.created_at >= NOW() - INTERVAL '7 days'
         GROUP BY p.name ORDER BY qty DESC LIMIT 3`,
        [merchantId]
      );
      topProducts = prods.rows.map((r: any) => `${r.name} (${r.qty}x)`);
    } catch {
      // DB lookup optional — continue with defaults
    }

    const fmtRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
    const dataCtx = `Omzet 30 hari: ${fmtRp(revenueSum)}, Transaksi: ${orderCount}, Produk terlaris minggu ini: ${topProducts.join(', ') || 'belum ada data'}.`;

    // --- Deterministic path (gratis) ---
    const matched = matchIntent(q);

    if (matched) {
      let markdown = '';
      if (matched.intent === 'REVENUE_ANALYSIS') {
        const avg = orderCount > 0 ? Math.round(revenueSum / orderCount) : 0;
        markdown =
          `**Omzet 30 Hari Terakhir — ${storeName}**\n\n` +
          `- **Total Omzet:** ${fmtRp(revenueSum)}\n` +
          `- **Jumlah Transaksi:** ${orderCount} struk\n` +
          `- **Rata-rata per Transaksi:** ${fmtRp(avg)}\n\n` +
          `💡 Dorong penjualan produk bundling atau up-selling untuk meningkatkan nilai rata-rata transaksi.`;
      } else if (matched.intent === 'STOCK_MANAGEMENT') {
        markdown =
          `**Status Stok — ${storeName}**\n\n` +
          `Produk terlaris minggu ini: ${topProducts.join(', ') || 'belum ada data'}\n\n` +
          `💡 Restok produk-produk terlaris sebelum akhir pekan untuk menghindari kehabisan stok saat lonjakan transaksi.`;
      } else if (matched.intent === 'MARKETING_PROMO') {
        markdown =
          `**Ide Promo untuk ${storeName}**\n\n` +
          `- **Happy Hour:** Diskon 10-15% pukul 14:00–16:00\n` +
          `- **Bundle Hemat:** Paket makanan + minuman lebih hemat Rp 5.000\n` +
          `- **Loyalty:** Poin ganda untuk pembayaran QRIS`;
      } else if (matched.intent === 'CRM_CHURN') {
        markdown =
          `**Analisa Pelanggan — ${storeName}**\n\n` +
          `- Identifikasi pelanggan yang sudah >14 hari tidak bertransaksi\n` +
          `- Kirim notifikasi WhatsApp dengan promo eksklusif untuk pelanggan setia\n` +
          `- Aktifkan program loyalty poin untuk meningkatkan retensi`;
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
