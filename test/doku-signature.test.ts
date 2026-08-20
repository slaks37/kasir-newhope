/**
 * Tanda tangan DOKU (non-SNAP / Jokul).
 *
 * MURNI. Nilai harapannya dihitung ULANG di dalam tes memakai node:crypto
 * langkah demi langkah persis seperti yang didokumentasikan DOKU — bukan
 * memanggil fungsi yang sedang diuji. Tes yang memakai implementasinya sendiri
 * sebagai jawaban hanya membuktikan bahwa kode itu konsisten dengan dirinya.
 */

import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  buatTandaTangan, verifikasiNotifikasi, stringKomponen, digest, stempelWaktu,
  PREFIX, TOLERANSI_DETIK,
} from '../src/server/dokuSignature';

const CLIENT_ID = 'BRN-0000-1700000000000';
const SECRET = 'SK-uji-rahasia-yang-panjang';
const REQUEST_ID = '11111111-2222-3333-4444-555555555555';
const TS = '2026-08-20T03:12:45Z';
const TARGET = '/checkout/v1/payment';
const BADAN = '{"order":{"amount":299000,"invoice_number":"NH-1"}}';

/** Perhitungan pembanding, ditulis ulang dari dokumentasi DOKU. */
function harapanDoku(body: string | null): string {
  const baris = [
    `Client-Id:${CLIENT_ID}`,
    `Request-Id:${REQUEST_ID}`,
    `Request-Timestamp:${TS}`,
    `Request-Target:${TARGET}`,
  ];
  if (body) {
    baris.push(`Digest:${createHash('sha256').update(body).digest('base64')}`);
  }
  const raw = baris.join('\n');
  return 'HMACSHA256=' + createHmac('sha256', SECRET).update(raw, 'utf8').digest('base64');
}

describe('bentuk tanda tangan', () => {
  it('cocok dengan perhitungan menurut dokumentasi DOKU', () => {
    const tt = buatTandaTangan({
      clientId: CLIENT_ID, requestId: REQUEST_ID, requestTimestamp: TS,
      requestTarget: TARGET, body: BADAN, secretKey: SECRET,
    });
    expect(tt).toBe(harapanDoku(BADAN));
    expect(tt.startsWith(PREFIX)).toBe(true);
  });

  it('GET tidak punya baris Digest sama sekali', () => {
    const komponen = stringKomponen({
      clientId: CLIENT_ID, requestId: REQUEST_ID, requestTimestamp: TS,
      requestTarget: '/checkout/v1/status',
    });
    expect(komponen).not.toContain('Digest:');
    expect(komponen.split('\n')).toHaveLength(4);
  });

  it('TIDAK ada baris baru di akhir — satu \\n berlebih mengubah tanda tangan total', () => {
    const komponen = stringKomponen({
      clientId: CLIENT_ID, requestId: REQUEST_ID, requestTimestamp: TS,
      requestTarget: TARGET, body: BADAN,
    });
    expect(komponen.endsWith('\n')).toBe(false);
    expect(komponen.split('\n')).toHaveLength(5);
  });

  it('Digest adalah base64 dari sha256, bukan hex', () => {
    expect(digest(BADAN)).toBe(createHash('sha256').update(BADAN).digest('base64'));
    expect(digest(BADAN)).not.toMatch(/^[0-9a-f]{64}$/);
  });

  it('stempel waktu tanpa milidetik — DOKU menolak bentuk .123Z', () => {
    const t = stempelWaktu(new Date('2026-08-20T03:12:45.678Z'));
    expect(t).toBe('2026-08-20T03:12:45Z');
    expect(t).not.toContain('.');
  });

  it('badan yang berbeda menghasilkan tanda tangan yang berbeda', () => {
    const a = buatTandaTangan({ clientId: CLIENT_ID, requestId: REQUEST_ID, requestTimestamp: TS,
      requestTarget: TARGET, body: BADAN, secretKey: SECRET });
    const b = buatTandaTangan({ clientId: CLIENT_ID, requestId: REQUEST_ID, requestTimestamp: TS,
      requestTarget: TARGET, body: BADAN.replace('299000', '1'), secretKey: SECRET });
    expect(a).not.toBe(b);
  });
});

describe('verifikasi notifikasi', () => {
  const NOTIF = '{"order":{"invoice_number":"NH-1","amount":299000},"transaction":{"status":"SUCCESS"}}';
  const PATH = '/api/v1/webhooks/doku';
  const sekarang = new Date(TS);

  const headerSah = (ubah: Record<string, string> = {}) => ({
    'client-id': CLIENT_ID,
    'request-id': REQUEST_ID,
    'request-timestamp': TS,
    signature: buatTandaTangan({
      clientId: CLIENT_ID, requestId: REQUEST_ID, requestTimestamp: TS,
      requestTarget: PATH, body: NOTIF, secretKey: SECRET,
    }),
    ...ubah,
  });

  it('menerima notifikasi yang sah', () => {
    expect(verifikasiNotifikasi({
      rawBody: NOTIF, headers: headerSah(), secretKey: SECRET, requestTarget: PATH, sekarang,
    })).toEqual({ sah: true });
  });

  it('gagal tertutup tanpa secret', () => {
    expect(verifikasiNotifikasi({
      rawBody: NOTIF, headers: headerSah(), secretKey: undefined, requestTarget: PATH, sekarang,
    })).toEqual({ sah: false, alasan: 'SECRET_TIDAK_DISET' });
  });

  it('menolak bila salah satu header wajib hilang', () => {
    for (const hilang of ['client-id', 'request-id', 'request-timestamp', 'signature']) {
      const h: any = headerSah();
      delete h[hilang];
      expect(verifikasiNotifikasi({
        rawBody: NOTIF, headers: h, secretKey: SECRET, requestTarget: PATH, sekarang,
      })).toEqual({ sah: false, alasan: 'HEADER_KURANG' });
    }
  });

  it('menolak badan yang diubah setelah ditandatangani', () => {
    const diubah = NOTIF.replace('299000', '1');
    expect(verifikasiNotifikasi({
      rawBody: diubah, headers: headerSah(), secretKey: SECRET, requestTarget: PATH, sekarang,
    })).toEqual({ sah: false, alasan: 'TIDAK_COCOK' });
  });

  it('menolak bila Request-Target kita salah — penyebab tersering notifikasi sah ditolak', () => {
    expect(verifikasiNotifikasi({
      rawBody: NOTIF, headers: headerSah(), secretKey: SECRET,
      requestTarget: '/path/yang/salah', sekarang,
    })).toEqual({ sah: false, alasan: 'TIDAK_COCOK' });
  });

  it('menolak stempel di luar toleransi, dua arah', () => {
    const tua = new Date(sekarang.getTime() + (TOLERANSI_DETIK + 60) * 1000);
    expect(verifikasiNotifikasi({
      rawBody: NOTIF, headers: headerSah(), secretKey: SECRET, requestTarget: PATH, sekarang: tua,
    })).toEqual({ sah: false, alasan: 'KEDALUWARSA' });

    const depan = new Date(sekarang.getTime() - (TOLERANSI_DETIK + 60) * 1000);
    expect(verifikasiNotifikasi({
      rawBody: NOTIF, headers: headerSah(), secretKey: SECRET, requestTarget: PATH, sekarang: depan,
    })).toEqual({ sah: false, alasan: 'KEDALUWARSA' });
  });

  it('menolak tanda tangan tanpa awalan HMACSHA256=', () => {
    const h = headerSah({ signature: 'abc123' });
    expect(verifikasiNotifikasi({
      rawBody: NOTIF, headers: h, secretKey: SECRET, requestTarget: PATH, sekarang,
    })).toEqual({ sah: false, alasan: 'FORMAT_SALAH' });
  });

  it('menolak secret yang salah', () => {
    expect(verifikasiNotifikasi({
      rawBody: NOTIF, headers: headerSah(), secretKey: 'SK-secret-yang-berbeda',
      requestTarget: PATH, sekarang,
    })).toEqual({ sah: false, alasan: 'TIDAK_COCOK' });
  });
});
