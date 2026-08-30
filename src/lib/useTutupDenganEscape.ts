import { useEffect } from 'react';

/**
 * Menutup modal dengan tombol Escape.
 *
 * KENAPA INI PERLU. Tidak satu pun modal di aplikasi ini menanggapi Escape —
 * ketahuan saat menulis uji E2E jalur kasir, ketika `page.keyboard.press
 * ('Escape')` tidak berpengaruh dan lapisan modal terus menghalangi klik
 * berikutnya.
 *
 * Yang dialami kasir sama persis, hanya lebih mahal: satu-satunya jalan keluar
 * adalah tombol X kecil di pojok, dicari dengan mata sementara antrean menunggu.
 * Escape adalah kebiasaan yang dibawa setiap orang dari aplikasi lain, dan
 * modal yang mengabaikannya terasa macet.
 *
 * Pendengarnya dipasang pada `document` supaya bekerja tanpa memedulikan
 * elemen mana yang sedang fokus — di dalam modal, fokusnya bisa ada di mana
 * saja, termasuk pada kolom isian.
 */
export function useTutupDenganEscape(tutup: () => void, aktif = true): void {
  useEffect(() => {
    if (!aktif) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); tutup(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tutup, aktif]);
}
