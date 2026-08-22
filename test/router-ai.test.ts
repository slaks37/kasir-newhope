/**
 * Router AI: Intent + kebutuhan data + kebutuhan penalaran + RBAC.
 *
 * MURNI. Yang dijaga di sini adalah kekeliruan yang paling mahal dan paling
 * sulit terlihat: pertanyaan yang kosakatanya dikenali dengan baik, tapi
 * jawabannya BUKAN angka. Confidence tinggi untuk "kenapa omzet saya turun"
 * dulu membuatnya dijawab satu angka — benar secara harfiah, tapi tidak
 * menjawab pertanyaannya.
 */

import { describe, it, expect } from 'vitest';
import { rutekan } from '../src/lib/assistant/router';
import type { ParsedIntent } from '../src/lib/assistant/types';

const parsed = (intent: string, confidence: number): ParsedIntent =>
  ({ intent, confidence, entities: {}, matchedKeywords: [] }) as ParsedIntent;

const SEMUA_MODUL = ['pos', 'ai', 'reports'];

describe('lapisan 0 — izin mendahului segalanya', () => {
  it('menolak saat modul AI tidak termasuk paket', () => {
    const h = rutekan({
      parsed: parsed('REVENUE_TODAY', 0.9),
      pertanyaan: 'berapa omzet hari ini',
      modulTerbuka: ['pos'],
    });
    expect(h.lapisan).toBe('TOLAK');
    expect(h.biaya).toBe(0);
  });

  it('penolakan tidak bergantung pada isi pertanyaan', () => {
    for (const q of ['berapa omzet', 'kenapa omzet turun', 'halo']) {
      expect(rutekan({ parsed: parsed('UNKNOWN', 0), pertanyaan: q, modulTerbuka: [] }).lapisan)
        .toBe('TOLAK');
    }
  });
});

describe('lapisan 1 — angka yang bisa dihitung langsung', () => {
  it('pertanyaan omzet dijawab gratis', () => {
    const h = rutekan({
      parsed: parsed('REVENUE_TODAY', 0.9),
      pertanyaan: 'berapa omzet hari ini',
      modulTerbuka: SEMUA_MODUL,
    });
    expect(h.lapisan).toBe('DETERMINISTIK');
    expect(h.biaya).toBe(0);
  });

  it('confidence di bawah ambang jatuh ke penalaran', () => {
    const h = rutekan({
      parsed: parsed('REVENUE_TODAY', 0.2),
      pertanyaan: 'omzet gimana ya kira kira',
      modulTerbuka: SEMUA_MODUL,
    });
    expect(h.lapisan).toBe('PENALARAN');
  });
});

describe('lapisan 2 — insight yang sudah dihitung batch', () => {
  it('pertanyaan slow moving memakai insight, bukan model', () => {
    const h = rutekan({
      parsed: parsed('SLOW_MOVING', 0.8),
      pertanyaan: 'produk apa yang slow moving',
      modulTerbuka: SEMUA_MODUL,
      adaInsightBatch: true,
    });
    expect(h.lapisan).toBe('ANALITIK');
    expect(h.biaya).toBe(0);
  });

  it('kalau batch belum pernah jalan, barulah model yang menjawab', () => {
    const h = rutekan({
      parsed: parsed('SLOW_MOVING', 0.8),
      pertanyaan: 'produk apa yang slow moving',
      modulTerbuka: SEMUA_MODUL,
      adaInsightBatch: false,
    });
    expect(h.lapisan).toBe('PENALARAN');
    expect(h.alasan).toBe('INSIGHT_BATCH_BELUM_ADA');
  });
});

describe('lapisan 3 — penalaran mengalahkan confidence tinggi', () => {
  it('INI PERBAIKAN INTINYA: kosakata dikenali, tapi jawabannya bukan angka', () => {
    const h = rutekan({
      // Confidence SANGAT tinggi — 'omzet', 'FNB', dan 'turun' semuanya dikenali.
      parsed: parsed('REVENUE_TREND', 0.95),
      pertanyaan: 'menurutmu kenapa omzet FNB saya turun?',
      modulTerbuka: SEMUA_MODUL,
    });
    expect(h.lapisan).toBe('PENALARAN');
    expect(h.alasan).toBe('BUTUH_PENALARAN');
    expect(h.biaya).toBe(1);
  });

  it('mengenali beragam bentuk pertanyaan yang menuntut penalaran', () => {
    const contoh = [
      'kenapa penjualan turun minggu ini',
      'sebaiknya saya naikkan harga atau tidak',
      'bagaimana cara meningkatkan omzet',
      'menurut kamu produk mana yang harus distop',
      'prediksi omzet bulan depan berapa',
      'bandingkan cabang mana yang lebih baik',
    ];
    for (const q of contoh) {
      const h = rutekan({ parsed: parsed('REVENUE_TODAY', 0.95), pertanyaan: q, modulTerbuka: SEMUA_MODUL });
      expect({ q, lapisan: h.lapisan }).toEqual({ q, lapisan: 'PENALARAN' });
    }
  });

  it('pertanyaan angka biasa TIDAK ikut terseret ke berbayar', () => {
    const contoh = [
      'berapa omzet hari ini',
      'stok apa yang menipis',
      'transaksi hari ini berapa',
    ];
    for (const q of contoh) {
      const h = rutekan({ parsed: parsed('REVENUE_TODAY', 0.9), pertanyaan: q, modulTerbuka: SEMUA_MODUL });
      expect({ q, biaya: h.biaya }).toEqual({ q, biaya: 0 });
    }
  });
});

describe('biaya hanya pada lapisan penalaran', () => {
  it('tiga lapisan lain selalu gratis', () => {
    const gratis = [
      rutekan({ parsed: parsed('REVENUE_TODAY', 0.9), pertanyaan: 'omzet hari ini', modulTerbuka: SEMUA_MODUL }),
      rutekan({ parsed: parsed('SLOW_MOVING', 0.9), pertanyaan: 'produk slow moving', modulTerbuka: SEMUA_MODUL, adaInsightBatch: true }),
      rutekan({ parsed: parsed('UNKNOWN', 0), pertanyaan: 'apa saja', modulTerbuka: [] }),
    ];
    expect(gratis.map((h) => h.biaya)).toEqual([0, 0, 0]);
  });
});
