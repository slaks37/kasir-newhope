/**
 * KEADAAN JARINGAN — satu sumber kebenaran untuk seluruh aplikasi.
 *
 * ATURANNYA SATU KALIMAT: aplikasi ini online. Offline adalah keadaan darurat
 * yang hanya boleh berlaku selama jaringannya memang benar-benar tidak ada,
 * dan harus berakhir sendiri begitu jaringannya kembali — tanpa perlu ada yang
 * menekan tombol atau memuat ulang halaman.
 *
 * KENAPA `navigator.onLine` SAJA TIDAK CUKUP.
 *
 * `navigator.onLine` hanya menjawab "apakah ada tautan ke jaringan lokal".
 * Kasir yang tersambung ke WiFi warung yang modemnya mati akan tetap dilaporkan
 * ONLINE oleh browser — padahal tidak satu pun permintaan bisa sampai ke
 * server. Sebaliknya nilainya nyaris tidak pernah salah ke arah lain: kalau ia
 * bilang OFFLINE, memang benar-benar tidak ada tautan.
 *
 * Jadi keadaan yang dipakai di sini adalah gabungan dua hal:
 *
 *   perangkat  -> `navigator.onLine`. Murah, langsung, dan cukup untuk tahu
 *                 kapan HARUS berhenti mencoba.
 *   server     -> hasil permintaan sungguhan yang terakhir. Inilah yang tahu
 *                 apakah data benar-benar bisa sampai.
 *
 * Yang kedua dicatat dari `fetchToko` — satu-satunya pintu ke server bagi
 * seluruh lalu lintas toko — sehingga tidak perlu ada denyut buatan yang
 * menghabiskan kuota kasir hanya untuk bertanya "masih ada internet?".
 * Ketukan (`ketuk`) hanya dijalankan saat memang tidak ada lalu lintas lain
 * yang bisa dijadikan bukti.
 *
 * TIDAK ADA "MODE OFFLINE" YANG BISA DIPILIH. Tidak ada sakelar, tidak ada
 * pengaturan. Offline bukan pilihan pengguna; ia keadaan yang terdeteksi.
 */

import { useEffect, useState } from 'react';

export interface KeadaanJaringan {
  /** Browser melihat ada tautan jaringan. Belum tentu server terjangkau. */
  perangkatOnline: boolean;
  /**
   * Permintaan terakhir ke server kita benar-benar sampai.
   *
   * `null` berarti belum pernah ada permintaan sejak halaman dibuka — belum
   * ada yang bisa dibuktikan ke arah mana pun, jadi diperlakukan sebagai
   * "anggap saja bisa" agar percobaan pertama tetap dilakukan.
   */
  serverTerjangkau: boolean | null;
  /** Kapan terakhir kali server benar-benar menjawab. */
  terakhirTerhubung: string | null;
  /** Sejak kapan keadaan terputus ini berlangsung. Null saat tersambung. */
  terputusSejak: string | null;
}

/**
 * DUA PERTANYAAN YANG BERBEDA, DAN KENAPA MENYATUKANNYA ADALAH JEBAKAN.
 *
 *   "Layak dicoba?"   -> `bolehMencoba`
 *   "Sedang sehat?"   -> `tersambung`
 *
 * Sempat keduanya dijawab satu fungsi yang mensyaratkan server terbukti
 * terjangkau. Akibatnya satu kegagalan jaringan mengunci seluruh sinkronisasi:
 * `serverTerjangkau` menjadi `false`, setiap percobaan berikutnya ditolak
 * sebelum sempat dikirim, dan karena tidak ada percobaan maka tidak ada pula
 * bukti baru yang bisa mengembalikannya ke `true`. Perangkat terjebak offline
 * selamanya di tengah jaringan yang sehat. Terbukti di
 * test/antrian-sinkron.test.ts: server yang pulih tetap tidak dihubungi.
 *
 * Karena itu yang MENGGATE percobaan hanya tautan perangkat. Kalau browser
 * bilang tidak ada tautan sama sekali, mencoba memang sia-sia dan hanya
 * menaikkan hitungan kegagalan. Selain itu — coba saja. Yang mengatur
 * kecepatannya sudah ada: backoff antrian.
 */
export function bolehMencoba(k: KeadaanJaringan = bacaKeadaan()): boolean {
  return k.perangkatOnline;
}

/**
 * Keadaan sehat: ada tautan DAN server belum terbukti tak terjangkau.
 *
 * Dipakai untuk apa yang DITAMPILKAN dan untuk mengenali pemulihan — bukan
 * untuk menahan percobaan.
 */
export function tersambung(k: KeadaanJaringan = bacaKeadaan()): boolean {
  return k.perangkatOnline && k.serverTerjangkau !== false;
}

function bacaPerangkat(): boolean {
  // Di lingkungan tanpa `navigator` (tes, render di server) jangan pernah
  // menyimpulkan offline. Menebak offline berarti mematikan sinkronisasi.
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') return true;
  return navigator.onLine;
}

let keadaan: KeadaanJaringan = {
  perangkatOnline: bacaPerangkat(),
  serverTerjangkau: null,
  terakhirTerhubung: null,
  terputusSejak: null,
};

const pendengar = new Set<(k: KeadaanJaringan) => void>();

function umumkan(berikut: Partial<KeadaanJaringan>): void {
  const sebelum = keadaan;
  const sesudah: KeadaanJaringan = { ...sebelum, ...berikut };

  // Menyalakan/mematikan penanda "terputus sejak" di satu tempat saja, supaya
  // tidak ada pemanggil yang lupa mengaturnya.
  const tersambungSebelum = tersambung(sebelum);
  const tersambungSesudah = tersambung(sesudah);
  if (tersambungSesudah && !tersambungSebelum) sesudah.terputusSejak = null;
  if (!tersambungSesudah && tersambungSebelum) {
    sesudah.terputusSejak = sebelum.terputusSejak ?? new Date().toISOString();
  }

  const berubah =
    sesudah.perangkatOnline !== sebelum.perangkatOnline ||
    sesudah.serverTerjangkau !== sebelum.serverTerjangkau ||
    sesudah.terakhirTerhubung !== sebelum.terakhirTerhubung ||
    sesudah.terputusSejak !== sebelum.terputusSejak;

  keadaan = sesudah;
  if (!berubah) return;
  for (const p of pendengar) {
    try { p(keadaan); } catch { /* satu pendengar yang gagal tidak boleh menjatuhkan yang lain */ }
  }
}

/**
 * Keadaan terkini — dengan tautan perangkat DIBACA ULANG setiap kali.
 *
 * Kenapa tidak cukup mengandalkan event `online`/`offline`: event bisa
 * terlewat. Tab yang dibekukan browser di latar belakang, ponsel yang tidur di
 * saku, halaman yang dimuat justru pada detik jaringan berpindah — semuanya
 * menghasilkan keadaan tersimpan yang basi, dan perangkat tetap menganggap
 * dirinya luring padahal sinyalnya sudah penuh. `navigator.onLine` hanya
 * pembacaan properti; membacanya ulang jauh lebih murah daripada satu struk
 * yang tertahan setengah hari karena satu event yang tidak sampai.
 *
 * Perubahan yang ditemukan di sini ikut diumumkan, sehingga layar menyusul
 * dengan sendirinya tanpa perlu ada yang memaksanya.
 */
export function bacaKeadaan(): KeadaanJaringan {
  const sekarang = bacaPerangkat();
  if (sekarang !== keadaan.perangkatOnline) umumkan({ perangkatOnline: sekarang });
  return keadaan;
}

/**
 * Server menjawab.
 *
 * Dipanggil untuk SETIAP respons yang diterima — termasuk 401, 403, dan 500.
 * Server yang menolak permintaan tetaplah server yang terjangkau; menganggap
 * 403 sebagai "offline" akan membuat aplikasi berhenti mencoba karena alasan
 * yang tidak ada hubungannya dengan jaringan.
 */
export function catatServerMenjawab(): void {
  umumkan({
    serverTerjangkau: true,
    terakhirTerhubung: new Date().toISOString(),
    // Respons yang sampai membuktikan tautannya ada, apa pun kata browser.
    perangkatOnline: true,
  });
}

/**
 * Permintaan tidak sampai sama sekali.
 *
 * Hanya untuk kegagalan di lapisan jaringan — `fetch` yang melempar. Kode
 * status berapa pun BUKAN kegagalan jaringan.
 */
export function catatServerTakTerjangkau(): void {
  umumkan({ serverTerjangkau: false });
}

/**
 * Berlangganan perubahan. Mengembalikan fungsi pembatalan.
 *
 * Pendengar langsung dipanggil sekali dengan keadaan saat ini, supaya
 * pemanggilnya tidak perlu membaca keadaan awal secara terpisah dan tidak ada
 * celah antara membaca dan berlangganan.
 */
export function langgananJaringan(fn: (k: KeadaanJaringan) => void): () => void {
  pendengar.add(fn);
  try { fn(keadaan); } catch { /* diabaikan */ }
  return () => { pendengar.delete(fn); };
}

let terpasang = false;

/**
 * Memasang pendengar event browser. Aman dipanggil berkali-kali.
 *
 * Event `offline` dipercaya sepenuhnya: kalau browser bilang tautannya putus,
 * memang putus. Event `online` hanya berarti "tautannya kembali" — belum tentu
 * server terjangkau — jadi status server dikembalikan ke `null` (belum
 * terbukti) supaya percobaan berikutnya benar-benar dilakukan, bukan langsung
 * diklaim sehat.
 */
export function pasangPendengarJaringan(): void {
  if (terpasang || typeof window === 'undefined') return;
  terpasang = true;

  window.addEventListener('online', () => {
    umumkan({ perangkatOnline: true, serverTerjangkau: null });
  });
  window.addEventListener('offline', () => {
    umumkan({ perangkatOnline: false });
  });
}

/**
 * Membuktikan keterjangkauan server tanpa mengirim data apa pun.
 *
 * Dipakai hanya saat keadaan sedang terputus: selama tersambung, lalu lintas
 * biasa sudah menjadi buktinya sendiri dan ketukan tambahan hanya membuang
 * kuota. `cache: 'no-store'` wajib — jawaban yang dilayani dari cache akan
 * melaporkan "server hidup" justru ketika ia mati.
 */
export async function ketuk(): Promise<boolean> {
  if (!bacaPerangkat()) {
    umumkan({ perangkatOnline: false });
    return false;
  }
  try {
    const res = await fetch('/api/health', { method: 'GET', cache: 'no-store' });
    // Apa pun kodenya: yang penting jawabannya sampai.
    void res;
    catatServerMenjawab();
    return true;
  } catch {
    catatServerTakTerjangkau();
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* JEMBATAN KE REACT                                                           */
/* -------------------------------------------------------------------------- */

export function useJaringan(): KeadaanJaringan {
  const [k, setK] = useState<KeadaanJaringan>(() => bacaKeadaan());
  useEffect(() => {
    pasangPendengarJaringan();
    return langgananJaringan(setK);
  }, []);
  return k;
}

/** Hanya untuk tes: mengembalikan modul ke keadaan awal. */
export function _resetJaringan(): void {
  keadaan = {
    perangkatOnline: bacaPerangkat(),
    serverTerjangkau: null,
    terakhirTerhubung: null,
    terputusSejak: null,
  };
  pendengar.clear();
}
