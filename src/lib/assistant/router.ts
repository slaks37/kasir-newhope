/**
 * Router AI: memutuskan lapisan mana yang menjawab sebuah pertanyaan.
 *
 * MASALAH YANG DIPERBAIKI. Sebelumnya keputusannya satu angka:
 *
 *     confidence >= 0.45  ->  jawab deterministik (gratis)
 *     confidence <  0.45  ->  panggil LLM (berbayar)
 *
 * Confidence mengukur SATU hal: seberapa yakin pencocok pola mengenali
 * kosakatanya. Ia tidak tahu apa-apa tentang apakah pertanyaannya bisa dijawab
 * dengan angka, atau justru menuntut penalaran.
 *
 *     "Berapa omzet FNB bulan ini?"        -> kosakata dikenal, cukup angka
 *     "Kenapa omzet FNB saya turun?"       -> kosakata SAMA dikenal, tapi
 *                                             jawabannya bukan angka
 *
 * Keduanya mendapat confidence tinggi karena kata `omzet`, `FNB`, dan `turun`
 * sama-sama dikenali. Yang kedua lalu dijawab dengan satu angka — dan merchant
 * mendapat jawaban yang benar secara harfiah tapi tidak menjawab pertanyaannya.
 *
 * ADVISORY_PATTERNS dibuat untuk menambal ini dengan menurunkan confidence saat
 * pola "kenapa/bagaimana/sebaiknya" muncul. Itu menambal gejalanya: satu angka
 * dipakai untuk mewakili dua pertimbangan yang berbeda, lalu dikoreksi dengan
 * angka lain.
 *
 * BENTUK BARUNYA: empat pertimbangan yang berdiri sendiri.
 *
 *     Lapisan 0  RBAC          -> boleh tidak merchant ini bertanya
 *     Lapisan 1  Deterministik -> angka yang bisa dihitung langsung
 *     Lapisan 2  Analitik      -> insight yang sudah dihitung batch semalam
 *     Lapisan 3  Penalaran     -> LLM, satu-satunya yang berbayar
 *
 * Berkas ini MURNI — tanpa I/O, tanpa database — supaya keputusannya bisa
 * diuji tanpa memanggil apa pun.
 */

import type { ParsedIntent } from './types';

export type Lapisan = 'TOLAK' | 'DETERMINISTIK' | 'ANALITIK' | 'PENALARAN';

export interface KeputusanRute {
  lapisan: Lapisan;
  /** Alasan singkat, untuk log dan untuk menjelaskan ke merchant bila ditolak. */
  alasan: string;
  /** Kredit yang akan ditagih. Hanya lapisan penalaran yang berbayar. */
  biaya: 0 | 1;
}

/**
 * Pertanyaan yang menuntut PENALARAN, bukan angka.
 *
 * Ciri bersama: jawabannya menghubungkan beberapa fakta, atau memilih di antara
 * kemungkinan. Tidak ada satu kolom pun di database yang berisi jawabannya.
 */
const POLA_PENALARAN: readonly RegExp[] = [
  /\bkenapa\b|\bmengapa\b|\bkok\b/i,
  /\bsebaiknya\b|\bsaran\b|\brekomendasi\b|\bmenurut\s*(mu|kamu|anda)\b/i,
  /\bbagaimana\s+(cara|supaya|agar)\b/i,
  /\bstrategi\b|\bcara\s+meningkatkan\b|\bbiar\s+naik\b/i,
  /\bprediksi\b|\bramalan\b|\bproyeksi\b|\bke\s*depan\b/i,
  /\bbandingkan\b|\blebih\s+baik\b|\bpilih\s+mana\b/i,
];

/**
 * Pertanyaan yang jawabannya sudah dihitung batch semalam.
 *
 * Bukan penalaran — angkanya ADA, hanya saja mahal dihitung saat ditanya, jadi
 * dihitung lebih dulu. Menjawabnya tidak perlu memanggil model.
 */
const INTENT_ANALITIK: readonly string[] = [
  'SLOW_MOVING',
  'CROSS_SELL',
  'CHURN_RISK',
  'BASKET_ANALYSIS',
  'REORDER_SUGGESTION',
  'CUSTOMER_SEGMENT',
];

export interface MasukanRute {
  parsed: ParsedIntent;
  /** Teks mentah — pola penalaran diuji terhadapnya, bukan terhadap intent. */
  pertanyaan: string;
  /** Modul yang dibuka paket merchant. */
  modulTerbuka: readonly string[];
  /** Insight batch tersedia untuk merchant ini. */
  adaInsightBatch?: boolean;
  /** Ambang confidence untuk jalur deterministik. */
  ambang?: number;
}

/**
 * Empat pertimbangan, diperiksa berurutan. Yang lebih awal lebih menentukan:
 * izin mendahului kemampuan, dan kemampuan mendahului biaya.
 */
export function rutekan(m: MasukanRute): KeputusanRute {
  const ambang = m.ambang ?? 0.45;

  // LAPISAN 0 — izin. Diperiksa PERTAMA, bukan terakhir: pertanyaan yang tidak
  // boleh dijawab tidak perlu dinilai kualitasnya, dan menjalankan pencocokan
  // lebih dulu hanya membocorkan bahwa fiturnya ada.
  if (!m.modulTerbuka.includes('ai')) {
    return { lapisan: 'TOLAK', alasan: 'MODUL_TIDAK_TERMASUK_PAKET', biaya: 0 };
  }

  const butuhPenalaran = POLA_PENALARAN.some((re) => re.test(m.pertanyaan));

  // LAPISAN 3 — penalaran. Diperiksa SEBELUM lapisan 1, karena inilah inti
  // perbaikannya: pertanyaan "kenapa omzet turun" boleh saja dikenali dengan
  // confidence tinggi, tapi confidence tinggi bukan alasan menjawabnya dengan
  // satu angka.
  if (butuhPenalaran) {
    return { lapisan: 'PENALARAN', alasan: 'BUTUH_PENALARAN', biaya: 1 };
  }

  // LAPISAN 2 — analitik. Angkanya ada, sudah dihitung semalam.
  if (INTENT_ANALITIK.includes(m.parsed.intent)) {
    return m.adaInsightBatch === false
      ? { lapisan: 'PENALARAN', alasan: 'INSIGHT_BATCH_BELUM_ADA', biaya: 1 }
      : { lapisan: 'ANALITIK', alasan: 'INSIGHT_TERSEDIA', biaya: 0 };
  }

  // LAPISAN 1 — deterministik. Angka yang bisa dihitung langsung dari data.
  if (m.parsed.intent !== 'UNKNOWN' && m.parsed.confidence >= ambang) {
    return { lapisan: 'DETERMINISTIK', alasan: 'INTENT_DIKENALI', biaya: 0 };
  }

  // Tidak dikenali dan tidak jelas menuntut penalaran. Model yang menjawab —
  // dan itu memang berbayar, karena tidak ada jalan gratis yang tersisa.
  return { lapisan: 'PENALARAN', alasan: 'INTENT_TIDAK_DIKENALI', biaya: 1 };
}
