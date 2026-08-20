/**
 * Tanda tangan DOKU (skema non-SNAP / Jokul).
 *
 * SATU MODUL untuk dua arah, karena aturannya memang sama persis:
 *
 *   - MENANDATANGANI permintaan kita ke DOKU (membuat QRIS, cek status)
 *   - MEMVERIFIKASI notifikasi yang DOKU kirim balik ke kita
 *
 * Menulisnya dua kali berarti dua aturan yang bisa menyimpang, dan gejalanya
 * paling menyesatkan di antara semua kerusakan: pembayaran berhasil di sisi
 * DOKU, uang sudah dipotong dari pelanggan, tapi langganan tidak pernah aktif
 * dan tidak ada galat di mana pun.
 *
 * BENTUKNYA, persis seperti yang didokumentasikan DOKU:
 *
 *     Digest = base64( sha256( badan-mentah ) )
 *
 *     raw = "Client-Id:{clientId}\n"
 *         + "Request-Id:{requestId}\n"
 *         + "Request-Timestamp:{timestamp}\n"
 *         + "Request-Target:{target}\n"
 *         + "Digest:{digest}"
 *
 *     Signature = "HMACSHA256=" + base64( hmacSha256(raw, secretKey) )
 *
 * TIGA HAL YANG PALING SERING MEMBUATNYA GAGAL, dan dijaga di sini:
 *
 *   1. TIDAK ADA "\n" di akhir string. Satu baris baru berlebih menghasilkan
 *      tanda tangan yang berbeda total.
 *   2. Digest dihitung dari BADAN MENTAH. Mem-parse JSON lalu menyusunnya ulang
 *      mengubah urutan kunci dan spasi; tanda tangan yang benar pun tidak akan
 *      pernah cocok.
 *   3. Permintaan GET TIDAK punya baris Digest sama sekali — bukan Digest
 *      kosong, melainkan barisnya tidak ada.
 *
 * Hanya memakai node:crypto. Tidak ada dependensi baru.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const PREFIX = 'HMACSHA256=';

export interface KomponenTandaTangan {
  clientId: string;
  requestId: string;
  /** ISO 8601 UTC tanpa milidetik, contoh 2026-08-20T03:12:45Z. */
  requestTimestamp: string;
  /** Path saja, TANPA host. Contoh: /qris/v1/payment-code */
  requestTarget: string;
  /** Badan mentah. Kosongkan untuk GET — barisnya akan dihilangkan. */
  body?: string | Buffer | null;
  secretKey: string;
}

/** base64( sha256( badan ) ) — bentuk Digest yang diminta DOKU. */
export function digest(body: string | Buffer): string {
  return createHash('sha256').update(body).digest('base64');
}

/**
 * Stempel waktu dalam bentuk yang diterima DOKU.
 *
 * Milidetik DIBUANG. `toISOString()` menghasilkan `...T03:12:45.123Z`, dan
 * bagian `.123` itu ditolak — kegagalan yang sulit dilacak karena pesannya
 * hanya "signature failed".
 */
export function stempelWaktu(pada: Date = new Date()): string {
  return pada.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** String komponen sebelum di-HMAC. Diekspor supaya bisa diperiksa saat debug. */
export function stringKomponen(k: Omit<KomponenTandaTangan, 'secretKey'>): string {
  const baris = [
    `Client-Id:${k.clientId}`,
    `Request-Id:${k.requestId}`,
    `Request-Timestamp:${k.requestTimestamp}`,
    `Request-Target:${k.requestTarget}`,
  ];

  // GET tidak punya badan, jadi tidak punya baris Digest.
  if (k.body != null && k.body.length > 0) {
    baris.push(`Digest:${digest(k.body)}`);
  }

  // TANPA "\n" di akhir. Ini yang paling sering keliru.
  return baris.join('\n');
}

export function buatTandaTangan(k: KomponenTandaTangan): string {
  const raw = stringKomponen(k);
  const tt = createHmac('sha256', k.secretKey).update(raw, 'utf8').digest('base64');
  return `${PREFIX}${tt}`;
}

export type HasilVerifikasi =
  | { sah: true }
  | { sah: false; alasan: 'SECRET_TIDAK_DISET' | 'HEADER_KURANG' | 'FORMAT_SALAH' | 'KEDALUWARSA' | 'TIDAK_COCOK' };

/**
 * Selisih waktu maksimum antara Request-Timestamp dan sekarang.
 *
 * Tanda tangan yang sah tetap sah selamanya kalau tidak dibatasi waktu. Siapa
 * pun yang pernah menyadap SATU notifikasi sah bisa mengirimnya ulang
 * berkali-kali. Idempotensi Request-Id menahan pengulangan notifikasi yang
 * SAMA; batas waktu ini yang menahan sisanya.
 */
export const TOLERANSI_DETIK = 600;

export interface MasukanVerifikasi {
  /** Badan MENTAH notifikasi, bukan hasil parse yang disusun ulang. */
  rawBody: string | Buffer;
  headers: Record<string, unknown>;
  secretKey: string | undefined | null;
  /**
   * Path URL notifikasi KITA, bukan path API DOKU.
   *
   * DOKU menandatangani notifikasi memakai path endpoint yang ia panggil. Kalau
   * notification URL yang didaftarkan `https://toko.com/api/v1/webhooks/doku`,
   * maka nilainya `/api/v1/webhooks/doku`. Salah nilai di sini membuat SETIAP
   * notifikasi sah ditolak.
   */
  requestTarget: string;
  sekarang?: Date;
}

function ambilHeader(headers: Record<string, unknown>, nama: string): string | null {
  const v = headers[nama.toLowerCase()] ?? headers[nama];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim();
  return null;
}

function cocokAman(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function verifikasiNotifikasi(m: MasukanVerifikasi): HasilVerifikasi {
  // Gagal TERTUTUP. Tanpa secret, menerima semuanya berarti siapa pun yang tahu
  // URL-nya bisa mengaktifkan langganan berbayar tanpa membayar.
  if (!m.secretKey || m.secretKey.length < 8) return { sah: false, alasan: 'SECRET_TIDAK_DISET' };

  const clientId = ambilHeader(m.headers, 'Client-Id');
  const requestId = ambilHeader(m.headers, 'Request-Id');
  const timestamp = ambilHeader(m.headers, 'Request-Timestamp');
  const signature = ambilHeader(m.headers, 'Signature');

  if (!clientId || !requestId || !timestamp || !signature) {
    return { sah: false, alasan: 'HEADER_KURANG' };
  }
  if (!signature.startsWith(PREFIX)) return { sah: false, alasan: 'FORMAT_SALAH' };

  const pada = new Date(timestamp);
  if (Number.isNaN(pada.getTime())) return { sah: false, alasan: 'FORMAT_SALAH' };

  const sekarang = (m.sekarang ?? new Date()).getTime();
  if (Math.abs(sekarang - pada.getTime()) > TOLERANSI_DETIK * 1000) {
    return { sah: false, alasan: 'KEDALUWARSA' };
  }

  const harapan = buatTandaTangan({
    clientId,
    requestId,
    requestTimestamp: timestamp,
    requestTarget: m.requestTarget,
    body: m.rawBody,
    secretKey: m.secretKey,
  });

  return cocokAman(harapan, signature) ? { sah: true } : { sah: false, alasan: 'TIDAK_COCOK' };
}
