/**
 * Verifikasi tanda tangan webhook pembayaran.
 *
 * MURNI. Ini penjaga satu-satunya jalur yang boleh mengaktifkan langganan
 * berbayar di produksi, jadi setiap cara melewatinya diuji secara terpisah —
 * bukan hanya "tanda tangan yang benar diterima".
 */

import { describe, it, expect } from 'vitest';
import {
  verifikasiWebhook, tandaTangani, ambilHeaderTandaTangan,
  TOLERANSI_DETIK, HEADER_TANDA_TANGAN,
} from '../src/server/webhookAuth';

const SECRET = 'rahasia-webhook-yang-cukup-panjang-32';
const BADAN = '{"eventId":"e1","eventType":"payment.succeeded","tenantId":"usr-1_FNB"}';
const kini = Math.floor(Date.now() / 1000);

describe('gagal tertutup', () => {
  it('menolak saat secret tidak diset — bukan menerima semuanya', () => {
    const h = verifikasiWebhook(BADAN, tandaTangani(BADAN, SECRET), undefined);
    expect(h).toEqual({ sah: false, alasan: 'SECRET_TIDAK_DISET' });
  });

  it('menolak secret yang terlalu pendek untuk berarti', () => {
    expect(verifikasiWebhook(BADAN, 'x', 'pendek').sah).toBe(false);
  });

  it('menolak permintaan tanpa header tanda tangan', () => {
    expect(verifikasiWebhook(BADAN, null, SECRET)).toEqual({ sah: false, alasan: 'HEADER_KOSONG' });
  });
});

describe('tanda tangan', () => {
  it('menerima yang dibuat dengan secret yang benar', () => {
    expect(verifikasiWebhook(BADAN, tandaTangani(BADAN, SECRET, kini), SECRET, kini))
      .toEqual({ sah: true });
  });

  it('menolak secret yang salah', () => {
    const palsu = tandaTangani(BADAN, 'secret-lain-yang-juga-panjang-32b', kini);
    expect(verifikasiWebhook(BADAN, palsu, SECRET, kini).sah).toBe(false);
  });

  it('menolak badan yang diubah SETELAH ditandatangani', () => {
    const tt = tandaTangani(BADAN, SECRET, kini);
    const diubah = BADAN.replace('usr-1_FNB', 'usr-penyerang_FNB');
    expect(verifikasiWebhook(diubah, tt, SECRET, kini).sah).toBe(false);
  });

  it('menolak header yang bukan heksadesimal', () => {
    expect(verifikasiWebhook(BADAN, 't=1,v1=bukan-hex!!', SECRET, kini))
      .toEqual({ sah: false, alasan: 'FORMAT_SALAH' });
  });
});

describe('anti kirim-ulang', () => {
  it('menolak stempel yang lebih tua dari toleransi', () => {
    const tua = tandaTangani(BADAN, SECRET, kini - TOLERANSI_DETIK - 1);
    expect(verifikasiWebhook(BADAN, tua, SECRET, kini))
      .toEqual({ sah: false, alasan: 'KEDALUWARSA' });
  });

  it('menerima yang masih dalam toleransi', () => {
    const hampir = tandaTangani(BADAN, SECRET, kini - TOLERANSI_DETIK + 5);
    expect(verifikasiWebhook(BADAN, hampir, SECRET, kini).sah).toBe(true);
  });

  it('menolak stempel dari MASA DEPAN — jam yang dimundurkan bukan alasan', () => {
    const depan = tandaTangani(BADAN, SECRET, kini + TOLERANSI_DETIK + 1);
    expect(verifikasiWebhook(BADAN, depan, SECRET, kini).sah).toBe(false);
  });

  it('stempel ikut ditandatangani — menggantinya membatalkan tanda tangan', () => {
    const tt = tandaTangani(BADAN, SECRET, kini - 1000);
    const digeser = tt.replace(`t=${kini - 1000}`, `t=${kini}`);
    expect(verifikasiWebhook(BADAN, digeser, SECRET, kini).sah).toBe(false);
  });
});

describe('bentuk header', () => {
  it('menerima hex polos dari gateway yang lebih sederhana', () => {
    const hanyaHex = tandaTangani(BADAN, SECRET, kini).split('v1=')[1];
    // Tanpa stempel, pesan yang ditandatangani adalah badan saja — jadi hex
    // dari bentuk berstempel memang TIDAK boleh cocok.
    expect(verifikasiWebhook(BADAN, hanyaHex, SECRET, kini).sah).toBe(false);
  });

  it('membaca nama header apa pun yang dipakai gateway', () => {
    for (const nama of HEADER_TANDA_TANGAN) {
      expect(ambilHeaderTandaTangan({ [nama]: 'abc' })).toBe('abc');
    }
    expect(ambilHeaderTandaTangan({})).toBeNull();
    expect(ambilHeaderTandaTangan({ 'x-signature': ['abc'] })).toBe('abc');
  });
});

describe('badan mentah, bukan hasil parse yang disusun ulang', () => {
  it('urutan kunci yang berubah membatalkan tanda tangan', () => {
    const tt = tandaTangani(BADAN, SECRET, kini);
    const disusunUlang = JSON.stringify(JSON.parse(BADAN.replace(
      '{"eventId":"e1","eventType"', '{"eventType"'
    ).replace('"eventType":"payment.succeeded"', '"eventType":"payment.succeeded","eventId":"e1"')));
    expect(verifikasiWebhook(disusunUlang, tt, SECRET, kini).sah).toBe(false);
  });

  it('menerima Buffer sama seperti string', () => {
    const tt = tandaTangani(BADAN, SECRET, kini);
    expect(verifikasiWebhook(Buffer.from(BADAN, 'utf8'), tt, SECRET, kini)).toEqual({ sah: true });
  });
});
