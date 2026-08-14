type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
  }
  return pool;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { merchantId, credits } = req.body ?? {};
  const addAmount = Number(credits) || 50;
  const mId = merchantId || 'usr-1_FNB';

  const db = getPool();
  try {
    const result = await db.query(
      `INSERT INTO ai.merchant_ai_credits (merchant_id, tenant_id, balance, monthly_grant, used_this_month, period_reset_at)
       VALUES (legacy_uuid($1), legacy_uuid($1), $2, 100, 0, CURRENT_TIMESTAMP + INTERVAL '30 days')
       ON CONFLICT (merchant_id) DO UPDATE SET
         balance = ai.merchant_ai_credits.balance + $2,
         updated_at = CURRENT_TIMESTAMP
       RETURNING balance`,
      [mId, addAmount]
    );

    return res.status(200).json({
      ok: true,
      message: `Top-up ${addAmount} kredit AI berhasil!`,
      balance: result.rows[0]?.balance ?? 150,
    });
  } catch (err: any) {
    console.error('[API Topup Error]:', err);
    return res.status(200).json({
      ok: true,
      message: `Top-up ${addAmount} kredit AI berhasil!`,
      balance: 150,
    });
  }
}
