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
import { rutekan, INTENT_KE_INSIGHT } from '../src/lib/assistant/router';
import type { ParsedIntent, IntentName } from '../src/lib/assistant/types';

/*
 * `intent` bertipe IntentName, BUKAN string.
 *
 * Versi pertama menerima string apa pun, dan tesnya lalu memakai nama karangan
 * ('SLOW_MOVING', 'REVENUE_TODAY') yang tidak pernah dihasilkan pencocok intent
 * mana pun. Router memakai nama karangan yang sama, jadi tesnya hijau sementara
 * lapisan analitik tidak pernah terpilih di produksi. Tipe yang longgar
 * membuat dua kekeliruan yang cocok satu sama lain terlihat seperti kebenaran.
 */
const parsed = (intent: IntentName, confidence: number): ParsedIntent =>
  ({ intent, confidence, entities: {}, matchedKeywords: [] });

const SEMUA_MODUL = ['pos', 'ai', 'reports'];

describe('lapisan 0 — izin mendahului segalanya', () => {
  it('menolak saat modul AI tidak termasuk paket', () => {
    const h = rutekan({
      parsed: parsed('GET_REVENUE_SUMMARY', 0.9),
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
      parsed: parsed('GET_REVENUE_SUMMARY', 0.9),
      pertanyaan: 'berapa omzet hari ini',
      modulTerbuka: SEMUA_MODUL,
    });
    expect(h.lapisan).toBe('DETERMINISTIK');
    expect(h.biaya).toBe(0);
  });

  it('confidence di bawah ambang jatuh ke penalaran', () => {
    const h = rutekan({
      parsed: parsed('GET_REVENUE_SUMMARY', 0.2),
      pertanyaan: 'omzet gimana ya kira kira',
      modulTerbuka: SEMUA_MODUL,
    });
    expect(h.lapisan).toBe('PENALARAN');
  });
});

describe('lapisan 2 — insight yang sudah dihitung batch', () => {
  /*
   * NAMA INTENT DI SINI HARUS YANG SUNGGUHAN.
   *
   * Versi pertama tes ini memakai 'SLOW_MOVING' — nama yang tidak pernah
   * dihasilkan pencocok intent mana pun, dan yang juga dipakai daftar di
   * router. Keduanya salah dengan cara yang sama, jadi tesnya HIJAU sementara
   * lapisan analitik tidak pernah terpilih satu kali pun di produksi: setiap
   * pertanyaan yang seharusnya gratis jatuh ke LLM berbayar.
   */
  it('pertanyaan slow moving memakai insight, bukan model', () => {
    const h = rutekan({
      parsed: parsed('GET_SLOW_MOVING', 0.8),
      pertanyaan: 'produk apa yang slow moving',
      modulTerbuka: SEMUA_MODUL,
      adaInsightBatch: true,
    });
    expect(h.lapisan).toBe('ANALITIK');
    expect(h.biaya).toBe(0);
  });

  it('kalau batch belum pernah jalan, barulah model yang menjawab', () => {
    const h = rutekan({
      parsed: parsed('GET_SLOW_MOVING', 0.8),
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
      parsed: parsed('GET_REVENUE_SUMMARY', 0.95),
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
      const h = rutekan({ parsed: parsed('GET_REVENUE_SUMMARY', 0.95), pertanyaan: q, modulTerbuka: SEMUA_MODUL });
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
      const h = rutekan({ parsed: parsed('GET_REVENUE_SUMMARY', 0.9), pertanyaan: q, modulTerbuka: SEMUA_MODUL });
      expect({ q, biaya: h.biaya }).toEqual({ q, biaya: 0 });
    }
  });
});

describe('peta intent ke kartu insight', () => {
  it('setiap intent analitik menunjuk kategori insight yang benar-benar ada', () => {
    const kategoriSah = new Set([
      'INVENTORY_ALERT', 'CROSS_SELL_OPPORTUNITY', 'CRM_CHURN', 'OPERATIONAL_PEAK',
      'FINANCIAL_PERFORMANCE', 'CALENDAR_BEHAVIOR', 'SHIFT_PERFORMANCE',
      'LAYOUT_UTILISATION', 'STAFF_BEHAVIOUR',
    ]);
    for (const [intent, kategori] of Object.entries(INTENT_KE_INSIGHT)) {
      expect(kategoriSah.has(kategori as string), `${intent} -> ${kategori}`).toBe(true);
    }
  });

  it('keputusan analitik membawa kategori yang menjawabnya', () => {
    const h = rutekan({
      parsed: parsed('GET_CHURN_CUSTOMERS', 0.8),
      pertanyaan: 'pelanggan mana yang mulai jarang datang',
      modulTerbuka: SEMUA_MODUL,
      adaInsightBatch: true,
    });
    expect(h.lapisan).toBe('ANALITIK');
    expect(h.kategoriInsight).toBe('CRM_CHURN');
  });
});

describe('biaya hanya pada lapisan penalaran', () => {
  it('tiga lapisan lain selalu gratis', () => {
    const gratis = [
      rutekan({ parsed: parsed('GET_REVENUE_SUMMARY', 0.9), pertanyaan: 'omzet hari ini', modulTerbuka: SEMUA_MODUL }),
      rutekan({ parsed: parsed('GET_SLOW_MOVING', 0.9), pertanyaan: 'produk slow moving', modulTerbuka: SEMUA_MODUL, adaInsightBatch: true }),
      rutekan({ parsed: parsed('UNKNOWN', 0), pertanyaan: 'apa saja', modulTerbuka: [] }),
    ];
    expect(gratis.map((h) => h.biaya)).toEqual([0, 0, 0]);
  });
});
