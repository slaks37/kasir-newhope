/**
 * Verifikasi tanda tangan webhook payment gateway.
 *
 * KENAPA INI ADA. Endpoint webhook adalah satu-satunya jalur yang boleh
 * MENGAKTIFKAN langganan berbayar di produksi — simulate-payment sudah ditutup
 * justru supaya jalurnya tinggal satu. Tapi selama isinya diterima apa adanya,
 * siapa pun yang tahu URL-nya bisa mengirim
 *
 *     {"eventId":"apa-saja","eventType":"payment.succeeded","tenantId":"..."}
 *
 * dan mendapat paket termahal selama 30 hari tanpa uang berpindah. Menutup
 * simulate-payment tanpa menutup ini hanya memindahkan pintunya, tidak
 * menguncinya.
 *
 * Berkas ini hanya memakai node:crypto — tidak ada dependensi baru — dan
 * dipakai bersama oleh billing-service maupun fungsi serverless, supaya tidak
 * ada dua aturan tanda tangan yang bisa menyimpang.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Selisih waktu maksimum antara stempel di header dan sekarang.
 *
 * Tanda tangan yang sah tetap sah selamanya kalau tidak dibatasi waktu. Siapa
 * pun yang pernah menyadap SATU permintaan sah — dari log proxy, dari riwayat
 * CI, dari layar orang lain — bisa mengirim ulang berkali-kali. Idempotensi
 * event_id menahan pengulangan event yang SAMA, tapi tidak menahan penyerang
 * yang mengganti eventId sambil memakai ulang badan pesan lain.
 */
export const TOLERANSI_DETIK = 300;

export type HasilVerifikasi =
  | { sah: true }
  | { sah: false; alasan: 'SECRET_TIDAK_DISET' | 'HEADER_KOSONG' | 'FORMAT_SALAH' | 'KEDALUWARSA' | 'TIDAK_COCOK' };

/**
 * Header yang dibaca. Beberapa gateway memakai nama berbeda; ketiganya
 * diterima supaya penggantian gateway tidak menuntut perubahan kode.
 */
export const HEADER_TANDA_TANGAN = ['x-signature', 'x-callback-signature', 'x-webhook-signature'];

interface Terurai {
  stempel: number | null;
  tandaTangan: string;
}

/**
 * Menerima dua bentuk:
 *
 *   t=1787179368,v1=9f86d081...   (berstempel waktu, disarankan)
 *   9f86d081...                    (hex polos, gateway yang lebih sederhana)
 *
 * Bentuk kedua tidak bisa dilindungi dari kirim-ulang oleh berkas ini; yang
 * menahannya tinggal idempotensi event_id.
 */
function urai(header: string): Terurai | null {
  const bersih = header.trim();
  if (!bersih) return null;

  if (bersih.includes('=')) {
    const bagian = new Map<string, string>();
    for (const potong of bersih.split(',')) {
      const [k, v] = potong.split('=', 2);
      if (k && v) bagian.set(k.trim(), v.trim());
    }
    const v1 = bagian.get('v1') ?? bagian.get('sha256') ?? bagian.get('signature');
    if (!v1) return null;
    const t = bagian.get('t');
    return { stempel: t ? Number(t) : null, tandaTangan: v1 };
  }

  return { stempel: null, tandaTangan: bersih };
}

/** Perbandingan yang tidak membocorkan berapa banyak karakter yang cocok. */
function cocokAman(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual melempar bila panjangnya berbeda — dan panjang yang
  // berbeda sudah cukup menjadi jawaban tanpa membandingkan isinya.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Memverifikasi satu permintaan webhook.
 *
 * `rawBody` HARUS badan mentah apa adanya, bukan hasil JSON.stringify dari
 * objek yang sudah di-parse. Mem-parse lalu menyusun ulang mengubah urutan
 * kunci dan spasi, sehingga tanda tangan yang benar pun tidak akan pernah
 * cocok — dan gejalanya terlihat seperti "gateway mengirim tanda tangan salah"
 * padahal kitalah yang mengubah pesannya.
 */
export function verifikasiWebhook(
  rawBody: string | Buffer,
  headerTandaTangan: string | undefined | null,
  secret: string | undefined | null,
  sekarangDetik: number = Math.floor(Date.now() / 1000)
): HasilVerifikasi {
  // Gagal TERTUTUP. Tanpa secret, satu-satunya perilaku yang aman adalah
  // menolak semuanya; menerima semuanya berarti webhook tanpa penjagaan sama
  // sekali, yang persis keadaan yang sedang diperbaiki.
  if (!secret || secret.length < 16) return { sah: false, alasan: 'SECRET_TIDAK_DISET' };
  if (!headerTandaTangan) return { sah: false, alasan: 'HEADER_KOSONG' };

  const terurai = urai(String(headerTandaTangan));
  if (!terurai || !/^[0-9a-f]+$/i.test(terurai.tandaTangan)) {
    return { sah: false, alasan: 'FORMAT_SALAH' };
  }

  if (terurai.stempel !== null) {
    if (!Number.isFinite(terurai.stempel)) return { sah: false, alasan: 'FORMAT_SALAH' };
    if (Math.abs(sekarangDetik - terurai.stempel) > TOLERANSI_DETIK) {
      return { sah: false, alasan: 'KEDALUWARSA' };
    }
  }

  const badan = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

  // Stempel ikut ditandatangani. Kalau tidak, stempelnya bisa diganti bebas
  // dan pembatasan waktu di atas tidak menjaga apa pun.
  const pesan = terurai.stempel !== null ? `${terurai.stempel}.${badan}` : badan;
  const harapan = createHmac('sha256', secret).update(pesan, 'utf8').digest('hex');

  return cocokAman(harapan, terurai.tandaTangan.toLowerCase())
    ? { sah: true }
    : { sah: false, alasan: 'TIDAK_COCOK' };
}

/** Mengambil header tanda tangan dari nama mana pun yang dipakai gateway. */
export function ambilHeaderTandaTangan(headers: Record<string, unknown>): string | null {
  for (const nama of HEADER_TANDA_TANGAN) {
    const v = headers[nama] ?? headers[nama.toUpperCase()];
    if (typeof v === 'string' && v.trim()) return v;
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  }
  return null;
}

/**
 * Menandatangani sebuah badan pesan — dipakai tes dan alat bantu lokal untuk
 * membuat permintaan yang sah, bukan oleh jalur produksi.
 */
export function tandaTangani(
  rawBody: string,
  secret: string,
  stempel: number = Math.floor(Date.now() / 1000)
): string {
  const tt = createHmac('sha256', secret).update(`${stempel}.${rawBody}`, 'utf8').digest('hex');
  return `t=${stempel},v1=${tt}`;
}
