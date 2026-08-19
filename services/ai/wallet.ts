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
import { resolveTenant } from '../shared/identity';
import type { AiCreditWallet } from '../../src/lib/assistant/types';

/**
 * Jatah bulanan bagi merchant yang paketnya tidak terbaca.
 *
 * NOL, bukan angka ramah. Sebelumnya file ini memakai konstanta 30 untuk semua
 * orang: paket Free yang dijual dengan janji 3× sebulan mendapat 30, dan paket
 * Pro yang dijual 90× juga mendapat 30 — merchant yang membayar Rp 299rb
 * menerima kuota yang persis sama dengan yang tidak membayar sama sekali.
 *
 * Jalur deterministik (stok, omzet, pelanggan) tetap gratis tanpa batas, jadi
 * nol di sini tidak mematikan apa pun yang merchant sudah punya — ia hanya
 * menutup jalur LLM berbayar sampai langganannya benar-benar terbaca.
 */
const JATAH_TANPA_PAKET = 0;

/**
 * Kuota AI menurut paket yang sedang berlaku.
 *
 * Dibaca lewat view kontrak, bukan dengan menempuh subscriptions -> plans
 * sendiri: `svc_ai` sengaja tidak punya hak baca ke skema `billing`, dan batas
 * itu lebih berharga daripada satu join yang dihemat.
 */
async function kuotaPaket(db: Db, tenantId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT ai_quota_effective FROM contract.merchant_entitlements WHERE merchant_id = $1`,
    [tenantId]
  );
  const n = Number(rows[0]?.ai_quota_effective);
  return Number.isFinite(n) && n >= 0 ? n : JATAH_TANPA_PAKET;
}

/**
 * Identitas merchant -> UUID tenant, lewat penerjemah bersama.
 *
 * Dulu file ini memanggil legacy_uuid() langsung. Akibatnya dompet kredit
 * menempel pada UUID sintetis, sementara transaksi merchant yang sama memakai
 * UUID hasil sinkronisasi — dua identitas berbeda untuk satu merchant, tanpa
 * satu pun error yang terlihat. Lihat services/shared/identity.ts.
 */
async function keUuid(db: Db, merchantId: string, businessId?: string): Promise<string> {
  const r = await resolveTenant(db, { merchantId, businessId });
  return r.tenantId;
}

/** Awal periode berikutnya, WIB. Kredit diperbarui tiap awal bulan. */
function periodeBerikutnya(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
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
  const jatah = await kuotaPaket(db, merchantId);

  const dibuat = await db.query(
    `INSERT INTO ai.merchant_ai_credits
       (merchant_id, tenant_id, balance, monthly_grant, used_this_month, period_reset_at)
     VALUES ($1, $1, $2, $2, 0, $3::timestamptz)
     ON CONFLICT (merchant_id) DO NOTHING
     RETURNING *`,
    [merchantId, jatah, periodeBerikutnya()]
  );
  if (dibuat.rows.length) return keWallet(dibuat.rows[0]);

  // Pembaruan periode dilakukan di SQL, bukan di aplikasi: dua replika yang
  // sama-sama mendeteksi periode lewat akan sama-sama menulis, dan yang kalah
  // menghapus pemakaian yang baru saja dicatat yang menang.
  //
  // Perubahan paket ikut ditangani di pernyataan yang sama, dalam tiga keadaan:
  //
  //   1. Periode habis      -> saldo diisi ulang sebesar jatah paket TERKINI.
  //   2. Naik paket         -> saldo DINAIKKAN ke jatah baru, berlaku saat itu
  //                            juga. Merchant yang membayar untuk 90 panggilan
  //                            tidak boleh menunggu awal bulan depan.
  //   3. Turun paket        -> saldo berjalan dibiarkan; hanya jatahnya yang
  //                            turun, dan itu berlaku pada pengisian berikutnya.
  //                            Saldo bisa berisi kredit hasil pembelian add-on,
  //                            dan menariknya kembali berarti mengambil sesuatu
  //                            yang sudah dibayar.
  //
  // GREATEST, bukan penambahan selisih. Menambahkan (jatah_baru - jatah_lama)
  // membuat naik-turun-naik paket menghasilkan kredit baru setiap putaran;
  // menaikkan SAMPAI jatah baru tidak bisa diulang untuk keuntungan.
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
      WHERE merchant_id = $1
      RETURNING *`,
    [merchantId, periodeBerikutnya(), jatah]
  );
  return keWallet(rows[0]);
}

/**
 * Memakai satu kredit. FALSE berarti saldo habis — pemanggil WAJIB menampilkan
 * paywall dan TIDAK BOLEH memanggil model.
 */
export async function pakaiKredit(db: Db, merchantIdMentah: string, businessId?: string): Promise<boolean> {
  await ambilDompet(db, merchantIdMentah, businessId);
  const merchantId = await keUuid(db, merchantIdMentah, businessId);
  const { rows } = await db.query(`SELECT consume_ai_credit($1::uuid) AS ok`, [merchantId]);
  return rows[0]?.ok === true;
}

/** Mengembalikan kredit ketika panggilan model gagal SETELAH kredit terpotong. */
export async function kembalikanKredit(db: Db, merchantIdMentah: string, businessId?: string): Promise<void> {
  const merchantId = await keUuid(db, merchantIdMentah, businessId);
  await db.query(`SELECT refund_ai_credit($1::uuid)`, [merchantId]);
}

/** Menambah kredit hasil pembelian add-on. */
export async function tambahKredit(
  db: Db,
  merchantIdMentah: string,
  jumlah: number,
  businessId?: string
): Promise<AiCreditWallet> {
  const awal = await ambilDompet(db, merchantIdMentah, businessId);
  const merchantId = await keUuid(db, merchantIdMentah, businessId);

  // Keberadaan BARISNYA yang menentukan, bukan besar jatahnya.
  //
  // Dulu di sini ada penjagaan `monthlyGrant === 0` untuk mengenali dompet
  // "belum sinkron". Itu berhenti benar begitu jatah mengikuti paket: paket
  // gratis dan langganan kedaluwarsa sama-sama berjatah 0, dan keduanya tetap
  // berhak membeli kredit tambahan — justru merekalah yang paling mungkin
  // membelinya. UPDATE yang tidak mengenai baris apa pun sudah cukup menjadi
  // jawaban untuk identitas yang tidak terikat merchant mana pun.
  const { rows } = await db.query(
    `UPDATE ai.merchant_ai_credits
        SET balance = balance + $2, updated_at = CURRENT_TIMESTAMP
      WHERE merchant_id = $1 RETURNING *`,
    [merchantId, Math.max(0, Math.trunc(jumlah))]
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
          credits_charged, latency_ms, model, prompt_tokens, completion_tokens)
       VALUES (uuidv7(), $1, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
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
      WHERE merchant_id = $1
      ORDER BY asked_at DESC LIMIT $2`,
    [merchantId, Math.min(Math.max(limit, 1), 200)]
  );

  const { rows: agg } = await db.query(
    `SELECT COUNT(*)::int                                       AS total,
            COUNT(*) FILTER (WHERE credits_charged = 0)::int    AS gratis,
            COALESCE(SUM(credits_charged), 0)::int              AS kredit,
            COALESCE(SUM(prompt_tokens), 0)::int                AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0)::int            AS completion_tokens
       FROM ai.ai_query_logs WHERE merchant_id = $1`,
    [merchantId]
  );

  const { rows: perSumber } = await db.query(
    `SELECT source, COUNT(*)::int AS n FROM ai.ai_query_logs
      WHERE merchant_id = $1 GROUP BY source`,
    [merchantId]
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
