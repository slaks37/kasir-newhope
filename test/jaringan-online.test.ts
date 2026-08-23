/**
 * ONLINE ADALAH KEADAAN NORMAL. OFFLINE HANYA DARURAT.
 *
 * Aturan yang dibuktikan berkas ini bisa ditulis dalam satu kalimat: aplikasi
 * ini selalu berusaha online, dan hanya boleh jatuh ke luring selama
 * jaringannya memang benar-benar tidak ada — lalu harus pulih SENDIRI begitu
 * jaringannya kembali, tanpa memuat ulang halaman dan tanpa ada yang menekan
 * tombol apa pun.
 *
 * Yang diuji bukan "apakah ada kode yang menangani offline", melainkan empat
 * hal yang masing-masing pernah salah:
 *
 *   1. Keadaan jaringan dibedakan dari keterjangkauan server. WiFi warung yang
 *      modemnya mati melaporkan ONLINE ke browser; itu keadaan paling menipu
 *      karena setiap indikator di perangkat tampak sehat.
 *
 *   2. Kegagalan tidak boleh MENGUNCI. Sempat satu kegagalan jaringan membuat
 *      seluruh sinkronisasi berhenti permanen: server ditandai tak terjangkau,
 *      setiap percobaan berikutnya ditolak sebelum dikirim, dan karena tidak
 *      ada percobaan maka tidak ada bukti baru yang bisa membatalkan tandanya.
 *
 *   3. Percobaan yang TIDAK PERNAH DILAKUKAN bukan percobaan yang gagal.
 *      Mencatatnya sebagai kegagalan menaikkan backoff sampai lima menit,
 *      sehingga kasir yang baru masuk area bersinyal masih harus menunggu lima
 *      menit lagi karena kegagalan yang penyebabnya sudah hilang.
 *
 *   4. Katalog yang gagal terkirim meninggalkan jejak. Dulu kegagalannya
 *      ditelan dengan alasan "kiriman berikutnya akan memperbaiki" — padahal
 *      kiriman berikutnya hanya terjadi kalau ada SUNTINGAN berikutnya.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

class PenyimpananUji {
  private isi = new Map<string, string>();
  getItem(k: string) { return this.isi.has(k) ? this.isi.get(k)! : null; }
  setItem(k: string, v: string) { this.isi.set(k, v); }
  removeItem(k: string) { this.isi.delete(k); }
  clear() { this.isi.clear(); }
  mentah(k: string) { return this.getItem(k); }
}
const simpanan = new PenyimpananUji();
(globalThis as any).localStorage = simpanan;

const BID = 'usr-jar_FNB';
const TARGET = {
  businessId: BID,
  sector: 'FNB' as const,
  storeName: 'Warung Jaringan',
  ownerRef: 'usr-jar',
};

/**
 * Menyetel apa yang dilihat browser tentang tautan jaringan.
 *
 * `navigator` sengaja dipasang sebagai objek biasa: yang diuji adalah cara
 * modul membaca nilainya, bukan implementasi browser.
 */
let navigatorUji: any = { onLine: true };
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  get: () => navigatorUji,
});

function setelPerangkat(online: boolean) {
  navigatorUji = { onLine: online };
}

/** Meniru lingkungan tanpa `navigator` sama sekali (render di server, tes). */
function tanpaNavigator() {
  navigatorUji = undefined;
}

/** Memuat ulang seluruh modul — meniru tab yang ditutup lalu dibuka lagi. */
async function muatUlang() {
  vi.resetModules();
  const jaringan = await import('../src/lib/sync/jaringan');
  const queue = await import('../src/lib/sync/queue');
  const tertunda = await import('../src/lib/sync/tertunda');
  return { jaringan, queue, tertunda };
}

function struk(id: string) {
  return {
    clientTxnId: id,
    invoiceNumber: `INV-${id}`,
    subtotal: 10000,
    totalAmount: 10000,
    paymentMethod: 'CASH',
    paymentStatus: 'COMPLETED',
    cashierName: 'Kasir Uji',
    items: [],
  } as any;
}

let dikirim: string[] = [];

/** Server sehat yang mencatat setiap URL yang benar-benar dihubungi. */
function serverHidup(jawab: (url: string) => any = () => ({ ok: true })) {
  dikirim = [];
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    dikirim.push(String(url));
    if (String(url).includes('/auth/session')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, token: 'm1.uji.uji' }) };
    }
    return { ok: true, status: 200, json: async () => jawab(String(url)) };
  });
}

/** Kabel dicabut: setiap permintaan gagal di lapisan jaringan. */
function serverMati() {
  dikirim = [];
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    dikirim.push(String(url));
    throw new Error('Failed to fetch');
  });
}

beforeEach(() => {
  simpanan.clear();
  dikirim = [];
  setelPerangkat(true);
});
afterEach(() => { vi.restoreAllMocks(); });

/* ========================================================================== */

describe('keadaan jaringan', () => {

  it('TANPA navigator: dianggap online — menebak offline berarti mematikan sinkronisasi', async () => {
    tanpaNavigator();
    const { jaringan } = await muatUlang();
    expect(jaringan.bacaKeadaan().perangkatOnline).toBe(true);
    expect(jaringan.bolehMencoba()).toBe(true);
  });

  it('membedakan "tidak ada tautan" dari "server tidak terjangkau"', async () => {
    const { jaringan } = await muatUlang();

    // WiFi menyala, server tidak menjawab. Browser tetap melaporkan online —
    // inilah keadaan yang tidak bisa dideteksi navigator.onLine sendirian.
    jaringan.catatServerTakTerjangkau();
    const k = jaringan.bacaKeadaan();
    expect(k.perangkatOnline).toBe(true);
    expect(k.serverTerjangkau).toBe(false);
    expect(jaringan.tersambung()).toBe(false);
  });

  it('SERVER TAK TERJANGKAU TIDAK MENGUNCI: percobaan berikutnya tetap boleh', async () => {
    const { jaringan } = await muatUlang();
    jaringan.catatServerTakTerjangkau();

    // Ini inti perbaikannya. Kalau `bolehMencoba` ikut menjadi false di sini,
    // tidak akan pernah ada permintaan lagi — dan tanpa permintaan tidak akan
    // pernah ada bukti bahwa servernya sudah hidup. Terkunci selamanya.
    expect(jaringan.bolehMencoba()).toBe(true);
  });

  it('respons apa pun — termasuk 401 dan 500 — membuktikan jaringan hidup', async () => {
    const { jaringan } = await muatUlang();
    jaringan.catatServerTakTerjangkau();
    expect(jaringan.tersambung()).toBe(false);

    // Server yang menolak permintaan tetaplah server yang terjangkau.
    jaringan.catatServerMenjawab();
    expect(jaringan.tersambung()).toBe(true);
    expect(jaringan.bacaKeadaan().terakhirTerhubung).toBeTruthy();
  });

  it('mencatat SEJAK KAPAN terputus, dan menghapusnya saat pulih', async () => {
    const { jaringan } = await muatUlang();
    expect(jaringan.bacaKeadaan().terputusSejak).toBeNull();

    jaringan.catatServerTakTerjangkau();
    const sejak = jaringan.bacaKeadaan().terputusSejak;
    expect(sejak).toBeTruthy();

    // Masih terputus: waktunya TIDAK boleh maju. Yang ingin dijawab layar
    // adalah "sudah berapa lama", bukan "kapan terakhir dicoba".
    jaringan.catatServerTakTerjangkau();
    expect(jaringan.bacaKeadaan().terputusSejak).toBe(sejak);

    jaringan.catatServerMenjawab();
    expect(jaringan.bacaKeadaan().terputusSejak).toBeNull();
  });

  it('tautan dibaca ULANG, bukan hanya diandalkan dari event yang bisa terlewat', async () => {
    setelPerangkat(false);
    const { jaringan } = await muatUlang();
    expect(jaringan.bolehMencoba()).toBe(false);

    // Jaringan kembali TANPA event `online` — persis yang terjadi pada tab yang
    // dibekukan browser di latar belakang atau ponsel yang tidur di saku.
    // Kalau modul ini hanya percaya event, perangkatnya akan menganggap dirinya
    // luring selamanya meski sinyalnya penuh.
    setelPerangkat(true);
    expect(jaringan.bolehMencoba()).toBe(true);
    expect(jaringan.bacaKeadaan().perangkatOnline).toBe(true);
  });

  it('pembacaan ulang itu ikut memberi tahu pendengar, jadi layar menyusul sendiri', async () => {
    setelPerangkat(false);
    const { jaringan } = await muatUlang();
    const terlihat: boolean[] = [];
    jaringan.langgananJaringan((k) => terlihat.push(k.perangkatOnline));
    expect(terlihat).toEqual([false]);

    setelPerangkat(true);
    jaringan.bacaKeadaan();
    expect(terlihat).toEqual([false, true]);
  });

  it('pendengar dipanggil segera saat berlangganan, lalu setiap perubahan', async () => {
    const { jaringan } = await muatUlang();
    const terlihat: boolean[] = [];

    // Dipanggil segera supaya tidak ada celah antara membaca keadaan awal dan
    // mulai mendengarkan — celah itulah tempat perubahan hilang.
    const lepas = jaringan.langgananJaringan((k) => terlihat.push(jaringan.tersambung(k)));
    expect(terlihat).toEqual([true]);

    jaringan.catatServerTakTerjangkau();
    expect(terlihat).toEqual([true, false]);

    lepas();
    jaringan.catatServerMenjawab();
    expect(terlihat).toEqual([true, false]);
  });
});

/* ========================================================================== */

describe('antrian saat benar-benar tidak ada jaringan', () => {

  it('TIDAK mencatat kegagalan — percobaan yang tak dilakukan bukan kegagalan', async () => {
    setelPerangkat(false);
    const { queue } = await muatUlang();
    serverHidup();

    queue.enqueue(BID, struk('t-luring'));
    const hasil = await queue.flush(TARGET);

    // Tidak ada satu pun permintaan keluar.
    expect(dikirim).toEqual([]);
    // Transaksinya tetap utuh di antrian…
    expect(hasil.pending).toBe(1);
    // …dan yang terpenting: hitungan kegagalan tetap nol, sehingga saat
    // jaringan kembali tidak ada backoff yang harus ditunggu lebih dulu.
    expect(hasil.failures).toBe(0);
    expect(hasil.lastErrorAt).toBeNull();
  });

  it('begitu tautan kembali, kiriman berikutnya langsung berhasil', async () => {
    setelPerangkat(false);
    const { queue } = await muatUlang();
    serverHidup();
    queue.enqueue(BID, struk('t-pulih'));
    await queue.flush(TARGET);
    expect(queue.getStatus(BID).pending).toBe(1);

    setelPerangkat(true);
    const hasil = await queue.flush(TARGET);
    expect(hasil.pending).toBe(0);
    expect(dikirim.some((u) => u.includes('/sync/transactions'))).toBe(true);
  });

  it('setelBackoff melepas jeda yang penyebabnya sudah hilang', async () => {
    const { queue } = await muatUlang();
    serverMati();
    queue.enqueue(BID, struk('t-backoff'));
    await queue.flush(TARGET);
    expect(queue.getStatus(BID).failures).toBe(1);

    // Tanpa ini, kiriman berikutnya ditahan 5 detik pertama — dan setelah
    // lima kegagalan beruntun, lima menit.
    queue.setelBackoff(BID);
    expect(queue.getStatus(BID).failures).toBe(0);

    serverHidup();
    const hasil = await queue.flush(TARGET);
    expect(hasil.pending).toBe(0);
  });
});

/* ========================================================================== */

describe('katalog yang gagal terkirim meninggalkan jejak', () => {

  it('kegagalan jaringan menyisakan penanda tertunda', async () => {
    const { queue, tertunda } = await muatUlang();
    serverMati();

    const ok = await queue.pushCatalog(TARGET, { products: [] });
    expect(ok).toBe(false);
    // Inilah yang dulu tidak ada: tidak ada satu pun jalur kode yang bisa tahu
    // katalognya tidak sampai.
    expect(tertunda.adaTertunda(BID, 'catalog')).toBe(true);
    expect(tertunda.tertundaSejak(BID, 'catalog')).toBeTruthy();
  });

  it('penandanya BERTAHAN setelah tab ditutup', async () => {
    let m = await muatUlang();
    serverMati();
    await m.queue.pushCatalog(TARGET, { products: [] });

    // Tab ditutup, dibuka lagi: seluruh state di memori hilang, penyimpanan
    // tetap. Penandanya harus ikut selamat, kalau tidak katalognya hilang
    // diam-diam persis seperti sebelum perbaikan.
    m = await muatUlang();
    expect(m.tertunda.adaTertunda(BID, 'catalog')).toBe(true);
  });

  it('hanya konfirmasi server yang mencabut penandanya', async () => {
    const { queue, tertunda } = await muatUlang();
    serverMati();
    await queue.pushCatalog(TARGET, { products: [] });
    expect(tertunda.adaTertunda(BID, 'catalog')).toBe(true);

    serverHidup();
    const ok = await queue.pushCatalog(TARGET, { products: [] });
    expect(ok).toBe(true);
    expect(tertunda.adaTertunda(BID, 'catalog')).toBe(false);
  });

  it('HTTP 500 tetap dianggap belum sampai', async () => {
    const { queue, tertunda } = await muatUlang();
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/session')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, token: 'm1.uji.uji' }) };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    });

    expect(await queue.pushCatalog(TARGET, { products: [] })).toBe(false);
    expect(tertunda.adaTertunda(BID, 'catalog')).toBe(true);
  });

  it('tanpa tautan jaringan: ditandai tertunda tanpa membuang percobaan', async () => {
    setelPerangkat(false);
    const { queue, tertunda } = await muatUlang();
    serverHidup();

    expect(await queue.pushCatalog(TARGET, { products: [] })).toBe(false);
    expect(dikirim).toEqual([]);
    expect(tertunda.adaTertunda(BID, 'catalog')).toBe(true);
  });

  it('cabang mengikuti aturan yang sama', async () => {
    const { queue, tertunda } = await muatUlang();
    serverMati();
    await queue.pushBranches(TARGET, [{ id: 'br-1', name: 'Cabang Uji' }]);
    expect(tertunda.adaTertunda(BID, 'branches')).toBe(true);

    serverHidup(() => ({ ok: true, rejected: [], maxOutlets: 3, activeOutlets: 1 }));
    const hasil = await queue.pushBranches(TARGET, [{ id: 'br-1', name: 'Cabang Uji' }]);
    expect(hasil.ok).toBe(true);
    expect(tertunda.adaTertunda(BID, 'branches')).toBe(false);
  });

  it('daftar tertunda menyebut keduanya, dan kosong setelah semua sampai', async () => {
    const { queue, tertunda } = await muatUlang();
    serverMati();
    await queue.pushCatalog(TARGET, { products: [] });
    await queue.pushBranches(TARGET, [{ id: 'br-1', name: 'Cabang Uji' }]);
    expect(tertunda.daftarTertunda(BID).sort()).toEqual(['branches', 'catalog']);

    serverHidup(() => ({ ok: true, rejected: [], maxOutlets: 3, activeOutlets: 1 }));
    await queue.pushCatalog(TARGET, { products: [] });
    await queue.pushBranches(TARGET, [{ id: 'br-1', name: 'Cabang Uji' }]);
    expect(tertunda.daftarTertunda(BID)).toEqual([]);
  });
});

/* ========================================================================== */

describe('lalu lintas biasa menjadi bukti keterjangkauan', () => {

  it('pengiriman antrian yang berhasil menandai server terjangkau', async () => {
    const { jaringan, queue } = await muatUlang();
    jaringan.catatServerTakTerjangkau();
    expect(jaringan.tersambung()).toBe(false);

    serverHidup();
    queue.enqueue(BID, struk('t-bukti'));
    await queue.flush(TARGET);

    // Tidak perlu denyut buatan: sinkronisasi biasa sudah membuktikannya, dan
    // itulah yang membuat aplikasi ini tidak menghabiskan kuota kasir hanya
    // untuk bertanya "masih ada internet?".
    expect(jaringan.tersambung()).toBe(true);
  });

  it('kegagalan jaringan sungguhan menandai server tak terjangkau', async () => {
    const { jaringan, queue } = await muatUlang();
    serverMati();
    queue.enqueue(BID, struk('t-putus'));
    await queue.flush(TARGET);
    expect(jaringan.tersambung()).toBe(false);
    expect(jaringan.bacaKeadaan().terputusSejak).toBeTruthy();
  });

  it('ketuk memulihkan status tanpa mengirim data apa pun', async () => {
    const { jaringan } = await muatUlang();
    jaringan.catatServerTakTerjangkau();

    serverHidup();
    expect(await jaringan.ketuk()).toBe(true);
    expect(jaringan.tersambung()).toBe(true);
    expect(dikirim).toEqual(['/api/health']);
  });

  it('ketuk saat tautan hilang tidak menyentuh jaringan sama sekali', async () => {
    setelPerangkat(false);
    const { jaringan } = await muatUlang();
    serverHidup();
    expect(await jaringan.ketuk()).toBe(false);
    expect(dikirim).toEqual([]);
  });
});
