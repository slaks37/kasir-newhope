/**
 * GET /api/v1/assistant/insights — kartu insight yang dihitung SEMALAM.
 *
 * KENAPA ENDPOINT INI ADA.
 *
 * Sembilan algoritma insight sudah lama berjalan DI PERAMBAN
 * (src/lib/assistant/insights.ts), menghitung dari data yang tersimpan di
 * perangkat. Batch semalam menulis hasilnya ke ai.daily_merchant_insights —
 * dan sampai berkas ini ada, TIDAK ADA SATU PUN kode yang membacanya kembali.
 * Tabelnya hanya bisa ditulis, tidak pernah dibaca, jadi seluruh biaya
 * menjalankan batch itu tidak menghasilkan apa-apa.
 *
 * Perhitungan di peramban punya tiga batas yang tidak bisa dilewati:
 *
 *   1. Hanya melihat data perangkat itu. Merchant dengan tiga outlet mendapat
 *      tiga jawaban berbeda untuk pertanyaan yang sama.
 *   2. Ikut membesar bersama riwayat. Toko dengan dua tahun transaksi
 *      membekukan tab saat kartu insight dihitung ulang.
 *   3. Tidak bisa dipakai AI Copilot untuk mendasari jawabannya, karena
 *      servernya tidak pernah melihat angka itu.
 *
 * Endpoint ini menyajikan versi server: satu kebenaran untuk semua perangkat
 * milik merchant yang sama, dan angka yang sama dengan yang dipakai asisten.
 *
 * Kesegarannya IKUT DIKIRIM, tidak disembunyikan. Insight basah kemarin yang
 * ditampilkan seolah-olah hari ini adalah cara membuat orang mengambil
 * keputusan dari angka yang sudah lewat.
 */

type VercelRequest = any;
type VercelResponse = any;
import pg from 'pg';
import { resolveTenantId } from '../../_lib/tenant.js';
import { jagaModul } from '../../_lib/entitlementGuard.js';
import { wajibToko } from '../../_lib/tokoContext.js';
import { sslUntuk } from '../../../src/server/sslDb.js';

let pool: pg.Pool | null = null;

function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL || '';
    pool = new pg.Pool({
      connectionString: url,
      ssl: sslUntuk(url),
      max: Number(process.env.PGPOOL_MAX || 2),
    });
  }
  return pool;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const ref = String(
    req.query?.businessId ?? req.query?.tenantId ?? req.body?.businessId ?? ''
  ).trim();
  if (!ref) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', detail: 'businessId wajib diisi.' });
  }
  // GERBANG IDENTITAS (lihat api/_lib/tokoContext.ts). Toko ditentukan dari
  // token, bukan dari isi permintaan.
  const toko = await wajibToko(req, res, ref);
  if (!toko) return;


  const db = getPool();

  try {
    const tenantId = toko.businessId;

    // Modul AI harus dibuka paket. Gerbangnya sama persis dengan
    // /assistant/query — insight semalam adalah bagian dari modul yang sama,
    // dan menyajikannya lewat pintu lain berarti paywall-nya bocor.
    const jaga = await jagaModul(db, tenantId, 'ai');
    if (!jaga.boleh) {
      return res.status(402).json({
        ok: false,
        error: 'MODUL_TIDAK_TERMASUK_PAKET',
        detail: jaga.alasan,
      });
    }

    // Kartu HARI INI. Kalau batch semalam belum jalan, yang terbaru yang
    // dikirim — beserta tanggalnya, supaya jelas ini kapan.
    const { rows: insight } = await db.query(
      `SELECT id, insight_date, category, priority, title, summary,
              metric_label AS "metricLabel", payload, actions, status
         FROM ai.daily_merchant_insights
        WHERE business_id = $1
          AND status = 'ACTIVE'
          AND insight_date = (
              SELECT MAX(insight_date) FROM ai.daily_merchant_insights
               WHERE business_id = $1 AND status = 'ACTIVE')
        ORDER BY priority, category`,
      [tenantId]
    );

    // Kategori mana yang SEHARUSNYA ada untuk sektor ini, dan mana yang belum
    // ditulis. Merchant yang tidak pernah melihat kartu tertentu berhak tahu
    // apakah itu karena tidak ada temuan, atau karena algoritmanya memang tidak
    // berlaku untuk usahanya.
    const { rows: cakupan } = await db.query(
      `SELECT category, implemented, berlaku_untuk_sektor AS "berlakuUntukSektor"
         FROM contract.algorithm_coverage
        WHERE business_id = $1
        ORDER BY category`,
      [tenantId]
    );

    // insight_freshness satu baris PER KATEGORI. Yang dilaporkan ke klien
    // adalah yang PALING TUA — sekumpulan kartu hanya sesegar anggota
    // terbasinya, dan mengambil baris pertama begitu saja akan melaporkan
    // "segar" selama satu kategori mana pun kebetulan baru diperbarui.
    const { rows: segar } = await db.query(
      `SELECT COUNT(*)::int                       AS kategori,
              COUNT(*) FILTER (WHERE basi)::int   AS kategori_basi,
              MAX(umur_jam)::numeric              AS umur_jam_tertua,
              MIN(insight_date)                   AS tanggal_tertua,
              BOOL_OR(basi)                       AS ada_yang_basi
         FROM contract.insight_freshness WHERE business_id = $1`,
      [tenantId]
    );

    const tanggal = insight[0]?.insight_date ?? null;
    const umurJam = tanggal
      ? Math.round((Date.now() - new Date(tanggal).getTime()) / 3_600_000)
      : null;

    return res.status(200).json({
      ok: true,
      tenantId,
      insightDate: tanggal,
      // Batch berjalan sekali sehari; lebih dari 26 jam berarti ada yang
      // terlewat. Ambang yang sama dipakai contract.insight_freshness.
      stale: umurJam === null ? true : umurJam > 26,
      ageHours: umurJam,
      insights: insight.map((r: any) => ({
        id: r.id,
        insightDate: r.insight_date,
        category: r.category,
        priority: r.priority,
        title: r.title,
        summary: r.summary,
        metricLabel: r.metricLabel,
        payload: r.payload,
        actions: r.actions,
        status: r.status,
      })),
      coverage: cakupan,
      freshness: segar[0]
        ? {
            categories: Number(segar[0].kategori),
            staleCategories: Number(segar[0].kategori_basi),
            oldestAgeHours: segar[0].umur_jam_tertua === null ? null : Math.round(Number(segar[0].umur_jam_tertua)),
            oldestDate: segar[0].tanggal_tertua,
            anyStale: segar[0].ada_yang_basi === true,
          }
        : null,
    });
  } catch (err: any) {
    console.error('[API Insights Error]:', err?.message);
    return res.status(503).json({ ok: false, error: 'INSIGHTS_UNAVAILABLE' });
  }
}
