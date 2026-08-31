/**
 * SINKRONISASI POS — antrian transaksi dan pengiriman katalog.
 *
 * KENAPA IRISAN INI AKHIRNYA DIPECAH, padahal sempat dinyatakan tidak bisa.
 *
 * Alasan penundaan sebelumnya: "`enqueueSync` dipanggil dari DALAM
 * `processPayment` dan `voidOrder`, jadi memisahkannya menuntut membalik arah
 * ketergantungan itu lebih dulu — perubahan perilaku, bukan penataan ulang."
 *
 * Premisnya keliru. Yang dilakukan kedua fungsi itu bukan bergantung pada
 * bagian dalam sinkronisasi, melainkan MENYERAHKAN satu order kepadanya. Itu
 * panggilan biasa ke modul lain, bukan lingkaran. Yang membuatnya tampak
 * seperti lingkaran adalah bentuk pengulangannya: pola tiga baris yang sama
 * disalin di kedua tempat.
 *
 *   enqueueSync(businessId, orderToPayload(order, role, otorisasi));
 *   setSyncStatus(getSyncStatus(businessId));
 *   void runSync(target);
 *
 * Tiga baris itu adalah SATU operasi — "antrikan order ini, lalu coba kirim" —
 * yang kebetulan ditulis terurai. Begitu ia diberi nama, tidak ada yang perlu
 * dibalik.
 *
 * URUTANNYA TETAP DIJAGA, dan urutan itulah yang penting: `enqueue` menulis ke
 * localStorage secara SINKRON sebelum baris berikutnya berjalan. Kalau tab
 * tertutup tepat sesudahnya, transaksinya tetap terkirim saat aplikasi dibuka
 * lagi. Pengirimannya sendiri sengaja tidak di-await — kasir tidak boleh
 * menunggu jaringan untuk menyelesaikan penjualan.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BusinessSector, Order, Product, Category } from '../types';
import {
  enqueue as enqueueSync,
  flush as flushSync,
  getStatus as getSyncStatus,
  orderToPayload,
  pushCatalog,
  type SyncStatus,
  type SyncTarget,
} from '../lib/sync/queue';

/** Bukti otorisasi pembatalan, terikat pada satu transaksi. */
export interface OtorisasiVoid {
  authorizedByRef: string;
  authorizationProof: string;
}

export interface Sinkronisasi {
  status: SyncStatus;
  /**
   * Mengantrikan satu order lalu mencoba mengirimnya.
   *
   * TIDAK PERNAH melempar dan tidak pernah di-await oleh pemanggilnya:
   * penjualan yang sudah sah tidak boleh dijatuhkan oleh jaringan.
   */
  antrikan: (order: Order, peran?: string, otorisasi?: OtorisasiVoid) => void;
  /** Memicu pengiriman antrian sekarang — untuk tombol "Sinkronkan". */
  kirimSekarang: () => void;
}

export function useSinkronisasiPOS(params: {
  businessId: string;
  sector: BusinessSector;
  storeName: string;
  ownerRef: string;
}): Sinkronisasi {
  const { businessId, sector, storeName, ownerRef } = params;

  /*
   * Target dibangun dengan useMemo dari nilai PRIMITIF, bukan diterima sebagai
   * objek. Objek yang dibuat ulang setiap render akan menjalankan ulang efek di
   * bawah pada setiap render juga — artinya pendengar 'online' dipasang-lepas
   * terus-menerus dan pewaktu 60 detik tidak pernah sempat berdetak.
   */
  const target = useMemo<SyncTarget>(
    () => ({ businessId, sector, storeName, ownerRef }),
    [businessId, sector, storeName, ownerRef]
  );

  const [status, setStatus] = useState<SyncStatus>(() => getSyncStatus(businessId));

  /**
   * Menjalankan pengiriman lalu menyegarkan status di layar.
   *
   * Sengaja tidak pernah melempar: pemanggil terdekatnya adalah jalur
   * penyelesaian transaksi, dan sinkronisasi yang gagal tidak boleh
   * menjatuhkan penjualan yang sudah sah.
   */
  const kirim = useCallback(async (t: SyncTarget) => {
    try {
      setStatus(getSyncStatus(t.businessId, true));
      setStatus(await flushSync(t));
    } catch {
      setStatus(getSyncStatus(t.businessId));
    }
  }, []);

  useEffect(() => {
    // Berpindah pengguna atau sektor berarti antrian yang berbeda.
    setStatus(getSyncStatus(target.businessId));

    // 1. Saat dibuka — mengirim apa pun yang tertinggal dari sesi sebelumnya.
    void kirim(target);

    // 2. Saat jaringan kembali. Ini pemicu terpenting bagi kasir yang seharian
    //    offline lalu masuk area ber-WiFi.
    const onOnline = () => void kirim(target);
    window.addEventListener('online', onOnline);

    // 3. Denyut berkala sebagai jaring pengaman. Event 'online' tidak selalu
    //    menyala di semua perangkat, dan server bisa saja yang tadi mati.
    const timer = window.setInterval(() => void kirim(target), 60_000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [target, kirim]);

  const antrikan = useCallback(
    (order: Order, peran?: string, otorisasi?: OtorisasiVoid) => {
      /*
       * URUTAN INI YANG PENTING, bukan sekadar rapi.
       *
       * `enqueueSync` menulis ke localStorage secara SINKRON sebelum baris
       * berikutnya berjalan. Kalau tab tertutup tepat sesudahnya, transaksinya
       * tetap ada dan akan terkirim saat aplikasi dibuka lagi.
       */
      enqueueSync(target.businessId, orderToPayload(order, peran, otorisasi));
      setStatus(getSyncStatus(target.businessId));
      void kirim(target);
    },
    [target, kirim]
  );

  const kirimSekarang = useCallback(() => void kirim(target), [target, kirim]);

  return { status, antrikan, kirimSekarang };
}

/**
 * Mengirim SELURUH katalog, bukan yang berubah saja.
 *
 * Kenapa kirim semuanya: melacak perubahan di sisi klien menuntut jurnal
 * perubahan yang aplikasi ini belum punya, dan jurnal yang meleset satu kali
 * menghasilkan katalog yang berbeda selamanya tanpa ada yang menyadari.
 *
 * Tanpa pengiriman ini, produk hanya sampai ke database kalau ia TERJUAL —
 * sehingga produk yang tidak pernah laku, justru yang paling perlu diketahui
 * pemilik, tidak akan pernah muncul di panel.
 *
 * Ditunda 8 detik dan di-reset setiap perubahan. `products` ikut berubah pada
 * SETIAP penjualan karena stoknya berkurang; tanpa penundaan, satu jam sibuk
 * akan mengirim ratusan katalog identik.
 */
export function useKatalogTersinkron(
  target: { businessId: string; sector: BusinessSector; storeName: string; ownerRef: string },
  products: Product[],
  categories: Category[]
): void {
  const { businessId, sector, storeName, ownerRef } = target;

  useEffect(() => {
    if (products.length === 0) return;

    const timer = window.setTimeout(() => {
      void pushCatalog(
        { businessId, sector, storeName, ownerRef },
        products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          price: p.price,
          costPrice: p.costPrice,
          unit: p.unit,
          description: p.description,
          categoryName: categories.find((c) => c.id === p.categoryId)?.name,
          isAvailable: p.isAvailable,
        }))
      );
    }, 8_000);

    return () => window.clearTimeout(timer);
  }, [products, categories, businessId, sector, storeName, ownerRef]);
}
