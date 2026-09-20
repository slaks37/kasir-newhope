/**
 * Dompet kredit AI dan jejak audit — bertahan di database.
 *
 * KENAPA INI HARUS DIPERBAIKI. Sebelumnya keduanya hidup di `Map` dalam memori,
 * warisan monolit. Tiga akibatnya nyata:
 *
 *   1. Restart mengembalikan saldo semua merchant ke 30. Merchant yang sudah
 *      memakai 30 kredit mendapat 30 lagi setiap kali kita deploy — dan itu
 *      biaya LLM yang benar-benar keluar.
 *   2. Dengan lebih dari satu replika ai-service, tiap replika punya dompet
 *      sendiri. Batas 30 kredit menjadi 30 DIKALI jumlah replika.
 *   3. Jejak audit hilang saat restart, padahal justru dipakai menjawab
 *      "kenapa tagihan LLM bulan ini naik".
 *
 * PENGURANGAN SALDO BERSIFAT ATOMIK. `consume_ai_credit()` melakukan
 * UPDATE ... WHERE balance > 0 RETURNING dalam satu pernyataan. Dua request
 * bersamaan pada saldo terakhir: satu mendapat TRUE, satu mendapat FALSE.
 * Membaca-lalu-menulis dari aplikasi akan membiarkan keduanya lolos.
 */

import type { Db } from '../shared/db';
import type { AiCreditWallet } from '../../src/lib/assistant/types';

const MONTHLY_GRANT = 30;

/**
 * Identitas merchant -> UUID tenant, lewat penerjemah bersama.
 *
 * Dulu file ini memanggil legacy_uuid() langsung. Akibatnya dompet kredit
 * menempel pada UUID sintetis, sementara transaksi merchant yang sama memakai
 * UUID hasil sinkronisasi — dua identitas berbeda untuk satu merchant, tanpa
 * satu pun error yang terlihat. Lihat services/shared/identity.ts.
 */
async function keUuid(db: Db, merchantId: string, businessId?: string): Promise<string> {
  // merchantId MUST be the verified session subject, never a supplied UUID.
  if (!merchantId || merchantId === 'local-development' || !businessId) throw new Error('AUTHENTICATION_REQUIRED');
  const owned = await db.query(
    'SELECT t.id FROM internal.merchants m JOIN internal.tenants t ON t.id=m.tenant_id WHERE m.external_ref=$1 AND t.owner_user_ref=$2',
    [businessId, merchantId]);
  if (!owned.rows.length) throw new Error('BUSINESS_NOT_OWNED');
  const wallets = await db.query(
    `SELECT t.id, w.merchant_id AS wallet_id FROM internal.tenants t
       LEFT JOIN ai.merchant_ai_credits w ON w.merchant_id=t.id
       WHERE t.owner_user_ref=$1 ORDER BY t.created_at,t.id`, [merchantId]);
  const existing = wallets.rows.filter((row: any) => row.wallet_id);
  // Preserve every historical balance; ambiguous legacy wallets need reconciliation.
  if (existing.length > 1) throw new Error('AI_MEMBER_WALLET_MERGE_REQUIRED');
  return String((existing[0] || wallets.rows[0]).id);
}

/** Awal periode berikutnya, WIB. Kredit diperbarui tiap awal bulan. */
function periodeBerikutnya(): string {
  const now = new Date(Date.now() + 7 * 3600000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 7 * 3600000).toISOString();
}

function keWallet(row: any): AiCreditWallet {
  return {
    merchantId: row.merchant_id,
    balance: Number(row.balance),
    monthlyGrant: Number(row.monthly_grant),
    usedThisMonth: Number(row.used_this_month),
    periodResetAt: new Date(row.period_reset_at).toISOString(),
  };
}

/**
 * Mengambil dompet, membuatnya bila belum ada, dan memperbarui periode bila
 * sudah lewat — semuanya dalam satu perjalanan ke database.
 */
/**
 * Dompet untuk merchant yang belum pernah sinkron ke database.
 *
 * `merchant_ai_credits.merchant_id` punya foreign key ke `tenants` (0006), jadi
 * dompet TIDAK BISA dibuat untuk merchant yang belum ada. FK itu sengaja
 * dipertahankan — ia yang menjamin dompet ikut terhapus saat merchant pergi.
 *
 * Yang dikembalikan di sini adalah dompet KOSONG, bukan dompet berisi 30.
 * Arahnya disengaja: jalur deterministik tetap gratis dan tetap jalan, tapi
 * jalur LLM berbayar tertutup sampai merchant benar-benar tersinkronisasi.
 * Sebaliknya — memberi 30 kredit pada identitas yang tidak terikat apa pun —
 * berarti siapa pun bisa mengarang merchantId baru dan mendapat panggilan LLM
 * gratis tanpa batas.
 */
function dompetBelumSinkron(merchantId: string): AiCreditWallet {
  return {
    merchantId,
    balance: 0,
    monthlyGrant: 0,
    usedThisMonth: 0,
    periodResetAt: periodeBerikutnya(),
  };
}

/** Kode error Postgres untuk pelanggaran foreign key. */
const FK_VIOLATION = '23503';

export async function ambilDompet(db: Db, merchantIdMentah: string, businessId?: string): Promise<AiCreditWallet> {
  const merchantId = await keUuid(db, merchantIdMentah, businessId);
  try {
    return await ambilAtauBuat(db, merchantId);
  } catch (err) {
    if ((err as any)?.code === FK_VIOLATION) return dompetBelumSinkron(merchantId);
    throw err;
  }
}

async function ambilAtauBuat(db: Db, merchantId: string): Promise<AiCreditWallet> {
  const dibuat = await db.query(
    `INSERT INTO ai.merchant_ai_credits
       (merchant_id, tenant_id, balance, monthly_grant, used_this_month, period_reset_at)
     VALUES ($1, $1, $2, $2, 0, $3::timestamptz)
     ON CONFLICT (merchant_id) DO NOTHING
     RETURNING *`,
    [merchantId, MONTHLY_GRANT, periodeBerikutnya()]
  );
  if (dibuat.rows.length) return keWallet(dibuat.rows[0]);

  // Pembaruan periode dilakukan di SQL, bukan di aplikasi: dua replika yang
  // sama-sama mendeteksi periode lewat akan sama-sama menulis, dan yang kalah
  // menghapus pemakaian yang baru saja dicatat yang menang.
  const { rows } = await db.query(
    `UPDATE ai.merchant_ai_credits
        SET balance         = CASE WHEN period_reset_at <= CURRENT_TIMESTAMP
                                   THEN monthly_grant ELSE balance END,
            used_this_month = CASE WHEN period_reset_at <= CURRENT_TIMESTAMP
                                   THEN 0 ELSE used_this_month END,
            period_reset_at = CASE WHEN period_reset_at <= CURRENT_TIMESTAMP
                                   THEN $2::timestamptz ELSE period_reset_at END
      WHERE merchant_id = $1
      RETURNING *`,
    [merchantId, periodeBerikutnya()]
  );
  return keWallet(rows[0]);
}

/**
 * Memakai satu kredit. FALSE berarti saldo habis — pemanggil WAJIB menampilkan
 * paywall dan TIDAK BOLEH memanggil model.
 */
export async function pakaiKredit(db: Db, merchantIdMentah: string, businessId?: string): Promise<boolean> {
  return !!(await reserveMemberCredit(db,merchantIdMentah,businessId));
}

export async function reserveMemberCredit(db:Db,memberId:string,businessId?:string):Promise<{periodResetAt:string}|null> {
  return db.tx(async c=>{
    const wallet=await ambilDompet(c,memberId,businessId);
    const result=await c.query(`UPDATE ai.merchant_ai_credits SET balance=balance-1,
      used_this_month=used_this_month+1,updated_at=now()
      WHERE merchant_id=$1 AND balance>0 RETURNING period_reset_at`,[wallet.merchantId]);
    return result.rows[0]?{periodResetAt:new Date(result.rows[0].period_reset_at).toISOString()}:null;
  });
}

/** Mengembalikan kredit ketika panggilan model gagal SETELAH kredit terpotong. */
export async function kembalikanKredit(db: Db, merchantIdMentah: string, businessId: string, periodResetAt: string): Promise<void> {
  const merchantId = await keUuid(db, merchantIdMentah, businessId);
  await db.tx(async c=>{
    await c.query("SELECT set_config('app.ai_credit_ledger_type','REFUND',true)");
    // Never move an old period's failed request into the new monthly allowance.
    await c.query(`UPDATE ai.merchant_ai_credits SET balance=balance+1,
      used_this_month=greatest(0,used_this_month-1),updated_at=now()
      WHERE merchant_id=$1 AND period_reset_at=$2::timestamptz`,[merchantId,periodResetAt]);
  });
}

/** Menambah kredit hasil pembelian add-on. */
export async function tambahKredit(
  db: Db,
  merchantIdMentah: string,
  jumlah: number,
  businessId?: string
): Promise<AiCreditWallet> {
  const awal = await ambilDompet(db, merchantIdMentah, businessId);
  // monthlyGrant 0 hanya terjadi pada dompet "belum sinkron" — tidak ada baris
  // untuk di-UPDATE, dan menambah kredit ke identitas yang tidak terikat
  // merchant mana pun tidak berarti apa-apa.
  if (awal.monthlyGrant === 0) return awal;

  const merchantId = await keUuid(db, merchantIdMentah, businessId);
  const amount = Math.max(0, Math.trunc(jumlah));
  if (amount === 0) return awal;
  // Fungsi database menandai perubahan ini TOPUP dan trigger menulis ledger
  // pada transaksi yang sama; tidak ada jalur saldo yang diam-diam berubah.
  await db.query(`SELECT ai.add_ai_credit($1::uuid, $2::int, $3)`, [merchantId, amount, 'api-topup']);
  const { rows } = await db.query(
    `SELECT * FROM ai.merchant_ai_credits WHERE merchant_id = $1`,
    [merchantId]
  );
  return rows.length ? keWallet(rows[0]) : awal;
}

/* -------------------------------------------------------------------------- */
/* JEJAK AUDIT                                                                 */
/* -------------------------------------------------------------------------- */

export interface AuditInput {
  merchantId: string;
  businessId?: string | null;
  query: string;
  intent: string;
  source: string;
  creditsCharged: number;
  latencyMs: number;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}

/**
 * Mencatat satu pertanyaan.
 *
 * Kegagalan ditelan: audit yang gagal tidak boleh menjatuhkan jawaban yang
 * sudah benar. Tapi tidak boleh hilang diam-diam, jadi tetap masuk log error.
 */
export async function catatAudit(db: Db, a: AuditInput): Promise<void> {
  try {
    const merchantId = await keUuid(db, a.merchantId, a.businessId ?? undefined);
    await db.query(
      `INSERT INTO ai.ai_query_logs
         (id, merchant_id, tenant_id, query_text, resolved_intent, source,
          credits_charged, latency_ms, model, prompt_tokens, completion_tokens,business_id)
       VALUES (uuidv7(), $1, $1, $2, $3, $4, $5, $6, $7, $8, $9,$10)`,
      [
        merchantId,
        a.query.slice(0, 2000),
        a.intent.slice(0, 64),
        a.source.slice(0, 20),
        a.creditsCharged,
        a.latencyMs,
        a.model ?? null,
        a.promptTokens ?? null,
        a.completionTokens ?? null,
        a.businessId ?? null,
      ]
    );
  } catch (err) {
    console.error('[ai] gagal mencatat audit:', (err as Error).message);
  }
}

/** Ringkasan biaya — menjawab "berapa persen pertanyaan yang gratis?". */
export async function ringkasanAudit(db: Db, merchantIdMentah: string, limit = 50, businessId?: string) {
  const merchantId = await keUuid(db, merchantIdMentah, businessId);
  const { rows: logs } = await db.query(
    `SELECT id, asked_at, query_text, resolved_intent, source, credits_charged,
            latency_ms, model, prompt_tokens, completion_tokens
       FROM ai.ai_query_logs
      WHERE merchant_id = $1 AND business_id=$2
      ORDER BY asked_at DESC LIMIT $3`,
    [merchantId, businessId, Math.min(Math.max(limit, 1), 200)]
  );

  const { rows: agg } = await db.query(
    `SELECT COUNT(*)::int                                       AS total,
            COUNT(*) FILTER (WHERE credits_charged = 0)::int    AS gratis,
            COALESCE(SUM(credits_charged), 0)::int              AS kredit,
            COALESCE(SUM(prompt_tokens), 0)::int                AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0)::int            AS completion_tokens
       FROM ai.ai_query_logs WHERE merchant_id = $1 AND business_id=$2`,
    [merchantId,businessId]
  );

  const { rows: perSumber } = await db.query(
    `SELECT source, COUNT(*)::int AS n FROM ai.ai_query_logs
      WHERE merchant_id = $1 AND business_id=$2 GROUP BY source`,
    [merchantId,businessId]
  );

  const a = agg[0];
  return {
    logs,
    total: a.total,
    zeroCostShare: a.total > 0 ? +((a.gratis / a.total) * 100).toFixed(1) : 100,
    creditsSpent: a.kredit,
    promptTokens: a.prompt_tokens,
    completionTokens: a.completion_tokens,
    byCostSource: Object.fromEntries(perSumber.map((r: any) => [r.source, r.n])),
  };
}
