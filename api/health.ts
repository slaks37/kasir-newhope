/**
 * KETUKAN JARINGAN.
 *
 * Satu-satunya tugasnya: membuktikan bahwa server ini terjangkau dari
 * perangkat kasir. Dipanggil oleh `src/lib/sync/jaringan.ts` hanya SAAT
 * keadaan sedang terputus — selama tersambung, lalu lintas sinkronisasi biasa
 * sudah menjadi buktinya sendiri.
 *
 * SENGAJA TIDAK MENYENTUH DATABASE. Yang ditanyakan adalah "apakah jaringannya
 * ada", bukan "apakah seluruh sistem sehat". Kalau endpoint ini ikut membuka
 * koneksi database, satu database yang lambat akan membuat setiap kasir di
 * seluruh negeri dilaporkan offline dan berhenti mengirim antriannya —
 * padahal jaringannya baik-baik saja. Jawaban yang cepat dan selalu ada itulah
 * gunanya.
 *
 * TIDAK MEMBUTUHKAN TOKEN, dan tidak mengembalikan apa pun tentang toko mana
 * pun. Tidak ada yang bisa disimpulkan dari jawabannya selain "server hidup".
 */

type VercelRequest = any;
type VercelResponse = any;

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Jawaban ini tidak boleh pernah dilayani dari cache mana pun. Jawaban lama
  // yang tersimpan akan melaporkan "server hidup" justru ketika ia mati, dan
  // seluruh gunanya endpoint ini hilang.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'HEAD') {
    res.status(204).end();
    return;
  }

  res.status(200).json({ ok: true, waktu: new Date().toISOString() });
}
