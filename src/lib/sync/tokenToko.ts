/**
 * Token perangkat untuk seluruh panggilan /api/v1/*.
 *
 * Sejak gerbang identitas dipasang di server, setiap permintaan ke endpoint
 * toko wajib membawa token. Berkas ini yang mengurusnya: menukar identitas
 * pemilik dengan token sekali, menyimpannya di perangkat, dan menyisipkannya ke
 * setiap permintaan.
 *
 * DIRANCANG UNTUK OFFLINE-FIRST. Token tersimpan di perangkat dan berlaku 30
 * hari, jadi kasir yang lama tanpa internet tetap bisa mengirim antriannya
 * begitu tersambung — tanpa perlu ada orang yang memasukkan kata sandi lebih
 * dulu. Yang menahan risikonya bukan masa berlaku pendek melainkan cakupan
 * token: ia hanya berlaku untuk satu toko.
 */

import { catatServerMenjawab, catatServerTakTerjangkau } from './jaringan';

const KUNCI = 'newhope_token_toko_';

export interface IdentitasToko {
  businessId: string;
  ownerRef: string;
  /** Diperlukan HANYA saat toko belum pernah ada di server. */
  storeName?: string;
  sector?: string;
}

function kunci(businessId: string) { return `${KUNCI}${businessId}`; }

export function bacaToken(businessId: string): string | null {
  try { return localStorage.getItem(kunci(businessId)); } catch { return null; }
}

export function simpanToken(businessId: string, token: string | null): void {
  try {
    if (token) localStorage.setItem(kunci(businessId), token);
    else localStorage.removeItem(kunci(businessId));
  } catch { /* penyimpanan penuh: permintaan berikutnya akan meminta token lagi */ }
}

let sedangAmbil: Map<string, Promise<string | null>> = new Map();

/**
 * Mengambil token, memakai yang tersimpan bila ada.
 *
 * Permintaan bersamaan untuk toko yang sama digabung menjadi satu — tanpa ini,
 * antrian yang menyala setelah token kedaluwarsa akan menembakkan puluhan
 * permintaan token sekaligus.
 */
export async function pastikanToken(id: IdentitasToko, paksaBaru = false): Promise<string | null> {
  if (!paksaBaru) {
    const ada = bacaToken(id.businessId);
    if (ada) return ada;
  }
  const berjalan = sedangAmbil.get(id.businessId);
  if (berjalan) return berjalan;

  const janji = (async () => {
    try {
      const res = await fetch('/api/v1/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: id.businessId,
          ownerRef: id.ownerRef,
          // Dikirim supaya panggilan pertama sekaligus mendaftarkan tokonya.
          // Tanpa ini muncul lingkaran: sinkron butuh token, token butuh toko,
          // toko lahir saat sinkron.
          storeName: id.storeName,
          sector: id.sector,
        }),
      });
      // Server menjawab — apa pun kodenya. Ini bukti keterjangkauan, dan
      // ditandai SEBELUM kode statusnya diperiksa: 401 dari server yang hidup
      // tidak boleh terbaca sebagai jaringan mati.
      catatServerMenjawab();
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.ok || !data?.token) return null;
      simpanToken(id.businessId, data.token);
      return data.token as string;
    } catch {
      catatServerTakTerjangkau();
      return null;
    } finally {
      sedangAmbil.delete(id.businessId);
    }
  })();

  sedangAmbil.set(id.businessId, janji);
  return janji;
}

/**
 * Pembungkus fetch yang menyisipkan token dan MENCOBA SEKALI LAGI dengan token
 * baru bila server menjawab 401.
 *
 * Percobaan ulang itu yang membuat token kedaluwarsa tidak terasa oleh kasir:
 * ia tidak melihat galat, hanya jeda sepersekian detik.
 */
export async function fetchToko(
  url: string,
  init: RequestInit,
  id: IdentitasToko
): Promise<Response> {
  const kirim = async (token: string | null) => {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      // Setiap respons yang sampai adalah bukti jaringan hidup, termasuk 4xx
      // dan 5xx. Inilah yang membuat aplikasi tidak perlu denyut buatan untuk
      // tahu ia online: lalu lintas sinkronisasi biasa sudah menjadi buktinya.
      catatServerMenjawab();
      return res;
    } catch (err) {
      catatServerTakTerjangkau();
      throw err;
    }
  };

  let res = await kirim(await pastikanToken(id));
  if (res.status === 401) {
    const baru = await pastikanToken(id, true);
    if (baru) res = await kirim(baru);
  }
  return res;
}
