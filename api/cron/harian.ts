/**
 * Proses harian: wawasan, skor risiko, dan pengingat tagihan.
 *
 * Ketiga proses ini sudah lengkap dan logikanya diuji sejak lama — tetapi TIDAK
 * ADA PENJADWAL yang menjalankannya. Tidak ada blok `crons` di vercel.json,
 * tidak ada alur kerja terjadwal, tidak ada apa pun. Ketiganya hanya terdaftar
 * sebagai perintah npm yang harus diketik orang.
 *
 * Akibatnya di produksi: `ai.daily_merchant_insights` tidak pernah terisi, jadi
 * kartu wawasan selalu kosong dan AI Copilot selalu jatuh ke jawaban sederhana.
 * Skor risiko berhenti berlangganan tidak pernah berubah. Pengingat tagihan
 * tidak pernah terkirim.
 *
 * Dijadwalkan 19:00 UTC = 02:00 WIB — setelah toko-toko tutup, sebelum yang
 * paling pagi buka.
 */

type VercelRequest = any;
type VercelResponse = any;
import { jagaCron } from './_jaga.js';

/** Batas waktu per proses. Satu yang menggantung tidak boleh menahan dua lainnya. */
const BATAS_MS = 60_000;

async function jalankan(nama: string, jalur: string): Promise<{ nama: string; ok: boolean; detail?: string }> {
  try {
    const mod = await import(jalur);
    const fn = mod.jalankanBatch ?? mod.main ?? mod.default;
    if (typeof fn !== 'function') return { nama, ok: false, detail: 'tidak ada fungsi masuk' };
    await Promise.race([
      fn(),
      new Promise((_, tolak) => setTimeout(() => tolak(new Error('batas waktu')), BATAS_MS)),
    ]);
    return { nama, ok: true };
  } catch (err: any) {
    console.error(`[cron/harian] ${nama}:`, err?.message);
    return { nama, ok: false, detail: err?.message };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!jagaCron(req, res)) return;

  // Berurutan, bukan bersamaan: ketiganya menulis ke basis data yang sama, dan
  // menjalankannya serentak hanya menambah beban tanpa menghemat waktu berarti.
  const hasil = [
    await jalankan('insight', '../../scripts/batch/daily-insights.mjs'),
    await jalankan('kesehatan', '../../scripts/batch/merchant-health.mjs'),
    await jalankan('tagihan', '../../scripts/batch/billing-reminders.mjs'),
  ];

  // Satu proses gagal tidak membatalkan yang lain, tapi tetap dilaporkan —
  // cron yang selalu menjawab 200 adalah cron yang kegagalannya tak pernah
  // terlihat.
  const gagal = hasil.filter((h) => !h.ok);
  return res.status(gagal.length ? 207 : 200).json({ ok: gagal.length === 0, hasil });
}
