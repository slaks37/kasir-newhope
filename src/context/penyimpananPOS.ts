/**
 * PENYIMPANAN LOKAL POS — pemuatan, penyimpanan, dan penjaga identitasnya.
 *
 * KENAPA INI BERKAS TERSENDIRI.
 *
 * Dulu semuanya ada di dalam `POSContext.tsx` sebagai tiga belas efek yang
 * hampir identik. Bentuk itulah yang melahirkan cacat penghapus data: setiap
 * efek menulis ke kunci yang diturunkan dari `currentUser.id`, dan id itu ada
 * di daftar dependensinya — jadi ketika id berubah, setiap efek menulis state
 * milik pengguna LAMA ke kunci pengguna BARU.
 *
 * Perbaikannya menuntut aturan yang sama diingat di tiga belas tempat. Aturan
 * seperti itu akan terlupakan di tempat keempat belas, dan yang terlupakan itu
 * yang akan menghapus penjualan merchant.
 *
 * Di sini aturannya STRUKTURAL: satu-satunya jalan menulis ke penyimpanan
 * ber-scope adalah lewat penulis yang dikembalikan hook ini, dan penulis itu
 * memeriksa identitas sebelum menulis. Tidak ada jalan lain yang bisa dipakai
 * secara tidak sengaja.
 */

import { useLayoutEffect, useRef } from 'react';
import type { BusinessSector } from '../types';
import { accountKey, makeBusinessId, partitionKey } from './TenantContext';

/*
 * Kunci penyimpanan diturunkan dari kunci partisi tenant, tidak pernah
 * dirangkai dengan tangan. Lihat src/context/TenantContext.tsx — `businessId`
 * adalah `${userId}_${sector}`.
 */
export const getScopedKey = (entity: string, userId: string, sector: BusinessSector): string =>
  partitionKey(makeBusinessId(userId, sector), entity);

export const getGlobalUserKey = (entity: string, userId: string): string =>
  accountKey(userId, entity);

export function loadScopedData<T>(
  entity: string,
  userId: string,
  sector: BusinessSector,
  fallback: T
): T {
  try {
    const saved = localStorage.getItem(getScopedKey(entity, userId, sector));
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error(`Failed to load scoped data for ${entity}:`, e);
  }
  return fallback;
}

export function loadGlobalUserData<T>(entity: string, userId: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(getGlobalUserKey(entity, userId));
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error(`Failed to load global user data for ${entity}:`, e);
  }
  return fallback;
}

/**
 * Menyimpan sebanyak yang muat, bukan menyerah pada percobaan pertama.
 *
 * `localStorage` melempar QuotaExceededError ketika penuh, dan kalau itu
 * dibiarkan lewat sebagai kegagalan, riwayat lokal berhenti diperbarui
 * SELAMANYA tanpa ada yang tahu — kasir terus berjualan, penyimpanannya diam.
 *
 * Jadi kuota yang penuh dijawab dengan menyimpan lebih sedikit. Riwayat yang
 * terpotong masih jauh lebih berguna daripada riwayat yang membeku, dan uangnya
 * sendiri tidak bergantung pada ini — ia sudah ada di antrian sinkronisasi.
 */
export function simpanBerjenjang<T>(kunci: string, baris: T[], jenjang: number[]): void {
  for (const n of jenjang) {
    try {
      localStorage.setItem(kunci, JSON.stringify(baris.slice(0, n)));
      return;
    } catch {
      /* coba jenjang berikutnya yang lebih kecil */
    }
  }
  console.error(`[penyimpanan] ${kunci}: gagal menyimpan bahkan pada ${jenjang.at(-1)} baris.`);
}

export interface PenulisPenyimpanan {
  /** Menyimpan koleksi ber-scope. Diabaikan bila state belum milik kunci ini. */
  scoped: (entity: string, nilai: unknown) => void;
  /**
   * Menyimpan koleksi ber-scope dengan batas jumlah baris bertingkat.
   * Dipakai untuk riwayat yang bisa tumbuh: orders, inventory_logs, shift_history.
   */
  scopedTerbatas: <T>(entity: string, baris: T[], jenjang: number[]) => void;
  /** Menyimpan data milik AKUN, bukan unit usaha. Tidak butuh penjaga identitas. */
  global: (entity: string, nilai: unknown) => void;
  /** Kunci unit usaha yang sedang berlaku. */
  kunci: string;
}

/**
 * Memasang penjaga identitas dan mengembalikan penulis yang aman.
 *
 * `muatUlang` dipanggil ketika identitasnya berubah — sebelum satu pun tulisan
 * terjadi. Pemanggilnya bertanggung jawab mengisi ulang seluruh state dari
 * penyimpanan di sana.
 */
export function usePenyimpananPOS(
  userId: string,
  sektor: BusinessSector,
  muatUlang: (userId: string, sektor: BusinessSector) => void
): PenulisPenyimpanan {
  const kunciSekarang = makeBusinessId(userId, sektor);
  const kunciTerpasang = useRef(kunciSekarang);

  /*
   * useLayoutEffect, bukan useEffect.
   *
   * Ia berjalan SEBELUM efek penyimpanan milik pemanggil pada pass render yang
   * sama. Dengan useEffect biasa, urutannya mengikuti urutan deklarasi — dan
   * efek penyimpanan yang dideklarasikan lebih dulu akan menimpa data sebelum
   * pemuatan ulang ini sempat berjalan. Itu tepat cacat yang sedang ditutup.
   */
  useLayoutEffect(() => {
    if (kunciTerpasang.current === kunciSekarang) return;
    muatUlang(userId, sektor);
    kunciTerpasang.current = kunciSekarang;
    // `muatUlang` sengaja TIDAK ada di daftar dependensi: ia dibuat ulang pada
    // setiap render, dan memasukkannya akan menjalankan blok ini terus-menerus.
    // Yang menentukan kapan ia harus berjalan adalah kuncinya, bukan identitas
    // fungsinya.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunciSekarang, userId, sektor]);

  /*
   * Dibaca dari ref, bukan dari state, supaya nilainya sudah benar pada pass
   * render yang sama tempat useLayoutEffect di atas memperbaruinya.
   */
  const boleh = () => kunciTerpasang.current === kunciSekarang;

  return {
    kunci: kunciSekarang,
    scoped: (entity, nilai) => {
      if (!boleh()) return;
      try {
        localStorage.setItem(getScopedKey(entity, userId, sektor), JSON.stringify(nilai));
      } catch (err) {
        console.error(`[penyimpanan] ${entity} gagal disimpan:`, err);
      }
    },
    scopedTerbatas: (entity, baris, jenjang) => {
      if (!boleh()) return;
      simpanBerjenjang(getScopedKey(entity, userId, sektor), baris, jenjang);
    },
    global: (entity, nilai) => {
      // TIDAK dijaga: data milik akun tidak berpindah ketika unit usahanya
      // berganti, jadi menulisnya di bawah identitas baru memang benar.
      try {
        localStorage.setItem(getGlobalUserKey(entity, userId), JSON.stringify(nilai));
      } catch (err) {
        console.error(`[penyimpanan] ${entity} gagal disimpan:`, err);
      }
    },
  };
}
