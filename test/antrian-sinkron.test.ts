/**
 * SIKLUS HIDUP ANTRIAN SINKRON, DIBUKTIKAN — BUKAN DIBACA.
 *
 * Klaim "antrian tidak pernah kehilangan transaksi" adalah klaim terberat yang
 * bisa dibuat tentang aplikasi kasir offline-first, dan sebelumnya hanya
 * didukung pembacaan kode. Berkas ini menjalankan modul antrian yang
 * SESUNGGUHNYA (src/lib/sync/queue.ts) melewati setiap cara ia bisa gagal:
 *
 *     buat → simpan luring → antre → kirim → gagal → backoff →
 *     kirim ulang → ACK server → keluar dari antrian
 *
 * Yang diuji secara khusus, karena keempatnya menghasilkan diagnosis yang
 * BERBEDA dan penanganan yang berbeda pula:
 *
 *     (a) antrian tidak ada
 *     (b) antrian ada tapi tidak awet   <- lihat "kuota localStorage penuh"
 *     (c) antrian ada tapi kiriman ulang gagal
 *     (d) antrian awet tapi pemulihan setelah crash salah
 *
 * localStorage di-shim, bukan di-mock: implementasinya menyimpan string
 * sungguhan, sehingga "tutup tab" dapat disimulasikan dengan membuang seluruh
 * state di memori modul dan membaca ulang dari penyimpanan — persis yang
 * terjadi saat aplikasi dibuka kembali.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* -- Shim localStorage ----------------------------------------------------- */

class PenyimpananUji {
  private isi = new Map<string, string>();
  /** Bila diset, setItem melempar — meniru kuota penuh. */
  public tolakTulis = false;

  getItem(k: string): string | null {
    return this.isi.has(k) ? this.isi.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    if (this.tolakTulis) {
      const e: any = new Error('QuotaExceededError');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.isi.set(k, v);
  }
  removeItem(k: string): void { this.isi.delete(k); }
  clear(): void { this.isi.clear(); }
  /** Isi mentah — untuk membuktikan apa yang BENAR-BENAR ada di disk. */
  mentah(k: string): string | null { return this.getItem(k); }
  rusakkan(k: string): void { this.isi.set(k, '{bukan json'); }
}

const simpanan = new PenyimpananUji();
(globalThis as any).localStorage = simpanan;

const BID = 'usr-uji_FNB';
const KUNCI_ANTRIAN = `newhope_sync_queue_${BID}`;
const TARGET = {
  businessId: BID,
  sector: 'FNB' as const,
  storeName: 'Warung Uji',
  ownerRef: 'usr-uji',
};

/** Memuat ulang modul antrian dari nol — meniru tab ditutup lalu dibuka lagi. */
async function bukaUlangAplikasi() {
  vi.resetModules();
  return import('../src/lib/sync/queue');
}

function struk(id: string, total = 10000, status = 'COMPLETED') {
  return {
    clientTxnId: id,
    invoiceNumber: `INV-${id}`,
    subtotal: total,
    totalAmount: total,
    paymentMethod: 'CASH',
    paymentStatus: status,
    orderType: 'DINE_IN',
    cashierName: 'Kasir Uji',
    items: [],
  } as any;
}

let fetchDipanggil: any[] = [];
function pasangServer(jawab: (badan: any, ke: number) => { ok: boolean; status?: number; body?: any }) {
  fetchDipanggil = [];
  (globalThis as any).fetch = vi.fn(async (_url: string, init: any) => {
    const badan = JSON.parse(init.body);
    // Permintaan token bukan kiriman batch — dijawab, tapi tidak dihitung.
    // Sejak gerbang identitas dipasang, setiap panggilan sinkron didahului
    // penukaran token bila perangkat belum memegangnya.
    if (String(_url).includes('/auth/session')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, token: 'm1.uji.uji', businessId: 'uji' }) };
    }
    fetchDipanggil.push(badan);
    const r = jawab(badan, fetchDipanggil.length);
    if (r.ok === false && r.status) {
      return { ok: false, status: r.status, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => r.body ?? { ok: true, accepted: badan.transactions.length } };
  });
}

beforeEach(() => { simpanan.clear(); simpanan.tolakTulis = false; fetchDipanggil = []; vi.useRealTimers(); });
afterEach(() => { vi.restoreAllMocks(); });

/* ========================================================================== */

describe('siklus hidup antrian sinkron', () => {

  it('JALUR NORMAL: antre → kirim → ACK → keluar dari antrian', async () => {
    const q = await bukaUlangAplikasi();
    pasangServer(() => ({ ok: true }));

    q.enqueue(BID, struk('t1'));
    q.enqueue(BID, struk('t2'));
    expect(q.getStatus(BID).pending).toBe(2);

    const hasil = await q.flush(TARGET);
    expect(hasil.pending).toBe(0);
    expect(hasil.failures).toBe(0);
    expect(hasil.lastSyncedAt).toBeTruthy();
    // Benar-benar kosong di penyimpanan, bukan hanya di memori.
    expect(JSON.parse(simpanan.mentah(KUNCI_ANTRIAN)!)).toEqual([]);
  });

  it('(b) AWET: tab ditutup tepat setelah antre — transaksi selamat', async () => {
    let q = await bukaUlangAplikasi();
    q.enqueue(BID, struk('t-selamat'));

    // Bukti bahwa ia sudah di penyimpanan SEBELUM apa pun dikirim.
    const diDisk = JSON.parse(simpanan.mentah(KUNCI_ANTRIAN)!);
    expect(diDisk).toHaveLength(1);
    expect(diDisk[0].clientTxnId).toBe('t-selamat');

    // Tab ditutup, seluruh state modul hilang, aplikasi dibuka lagi.
    q = await bukaUlangAplikasi();
    expect(q.getStatus(BID).pending).toBe(1);

    pasangServer(() => ({ ok: true }));
    await q.flush(TARGET);
    expect(fetchDipanggil[0].transactions[0].clientTxnId).toBe('t-selamat');
  });

  it('(c) JARINGAN MATI: antrian TIDAK disentuh, kegagalan dihitung', async () => {
    const q = await bukaUlangAplikasi();
    q.enqueue(BID, struk('t-jaringan'));
    (globalThis as any).fetch = vi.fn(async (u: string) =>
      String(u).includes('/auth/session')
        ? { ok: true, status: 200, json: async () => ({ ok: true, token: 'm1.uji.uji' }) }
        : Promise.reject(new Error('Failed to fetch')));

    const hasil = await q.flush(TARGET);
    expect(hasil.pending).toBe(1);          // masih di antrian
    expect(hasil.failures).toBe(1);
    expect(hasil.lastError).toBeTruthy();
    expect(JSON.parse(simpanan.mentah(KUNCI_ANTRIAN)!)).toHaveLength(1);
  });

  it('(c) SERVER 500: sama — tidak ada yang dibuang', async () => {
    const q = await bukaUlangAplikasi();
    q.enqueue(BID, struk('t-500'));
    pasangServer(() => ({ ok: false, status: 500 }));

    const hasil = await q.flush(TARGET);
    expect(hasil.pending).toBe(1);
    expect(hasil.failures).toBe(1);
  });

  it('(c) SERVER ok:false: dianggap gagal, bukan sukses', async () => {
    const q = await bukaUlangAplikasi();
    q.enqueue(BID, struk('t-tolak'));
    pasangServer(() => ({ ok: true, body: { ok: false, error: 'SYNC_FAILED' } }));

    const hasil = await q.flush(TARGET);
    expect(hasil.pending).toBe(1);
    expect(hasil.failures).toBe(1);
  });

  it('BACKOFF menahan percobaan berikutnya, lalu melepasnya', async () => {
    const q = await bukaUlangAplikasi();
    q.enqueue(BID, struk('t-backoff'));
    (globalThis as any).fetch = vi.fn(async (u: string) =>
      String(u).includes('/auth/session')
        ? { ok: true, status: 200, json: async () => ({ ok: true, token: 'm1.uji.uji' }) }
        : Promise.reject(new Error('mati')));
    await q.flush(TARGET);
    expect(fetchDipanggil.length ?? 0).toBe(0);

    // Percobaan kedua langsung: harus DITAHAN (tidak memanggil fetch lagi).
    const panggilan = ((globalThis as any).fetch as any).mock.calls.length;
    await q.flush(TARGET);
    expect(((globalThis as any).fetch as any).mock.calls.length).toBe(panggilan);

    // Setelah jeda backoff lewat, ia mencoba lagi.
    const meta = JSON.parse(simpanan.mentah(`newhope_sync_meta_${BID}`)!);
    meta.lastErrorAt = new Date(Date.now() - 10 * 60_000).toISOString();
    simpanan.setItem(`newhope_sync_meta_${BID}`, JSON.stringify(meta));
    pasangServer(() => ({ ok: true }));
    const hasil = await q.flush(TARGET);
    expect(hasil.pending).toBe(0);
  });

  it('KIRIM ULANG memakai idempotencyKey yang SAMA', async () => {
    const q = await bukaUlangAplikasi();
    q.enqueue(BID, struk('t-ulang'));
    let gagalDulu = true;
    pasangServer(() => {
      if (gagalDulu) { gagalDulu = false; return { ok: false, status: 503 }; }
      return { ok: true };
    });

    await q.flush(TARGET);
    const meta = JSON.parse(simpanan.mentah(`newhope_sync_meta_${BID}`)!);
    meta.lastErrorAt = new Date(Date.now() - 10 * 60_000).toISOString();
    simpanan.setItem(`newhope_sync_meta_${BID}`, JSON.stringify(meta));
    await q.flush(TARGET);

    expect(fetchDipanggil).toHaveLength(2);
    expect(fetchDipanggil[0].idempotencyKey).toBe(fetchDipanggil[1].idempotencyKey);
  });

  it('VOID memakai clientTxnId sama tapi idempotencyKey BERBEDA', async () => {
    const q = await bukaUlangAplikasi();
    pasangServer(() => ({ ok: true }));

    q.enqueue(BID, struk('t-void', 50000, 'COMPLETED'));
    await q.flush(TARGET);
    const kunciJual = fetchDipanggil[0].idempotencyKey;

    q.enqueue(BID, struk('t-void', 50000, 'CANCELLED'));
    await q.flush(TARGET);
    const kunciVoid = fetchDipanggil[1].idempotencyKey;

    // Kalau sama, server menganggap pembatalan sebagai pengulangan penjualan
    // dan uang yang sudah dikembalikan tetap terhitung sebagai omzet.
    expect(kunciVoid).not.toBe(kunciJual);
  });

  it('ANTRE SAAT PENGIRIMAN BERLANGSUNG: yang baru tidak pernah hilang', async () => {
    const q = await bukaUlangAplikasi();
    q.enqueue(BID, struk('t-lama'));

    let sudahSisip = false;
    (globalThis as any).fetch = vi.fn(async (_u: string, init: any) => {
      if (String(_u).includes('/auth/session')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, token: 'm1.uji.uji', businessId: 'uji' }) };
      }
      fetchDipanggil.push(JSON.parse(init.body));
      // Kasir melayani pelanggan berikutnya TEPAT saat kiriman sedang jalan.
      // Hanya sekali, supaya rekursi flush punya ujung.
      if (!sudahSisip) { sudahSisip = true; q.enqueue(BID, struk('t-baru')); }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });

    await q.flush(TARGET);

    // Invariannya BUKAN "t-baru masih di antrian" — flush memanggil dirinya
    // sendiri untuk sisa antrian, jadi ia boleh saja langsung ikut terkirim.
    // Yang harus dijamin: ia tidak pernah dibuang tanpa pernah sampai.
    const tersisa = JSON.parse(simpanan.mentah(KUNCI_ANTRIAN)!)
      .map((t: any) => t.clientTxnId);
    const terkirim = fetchDipanggil.flatMap((b: any) =>
      b.transactions.map((t: any) => t.clientTxnId));

    expect(terkirim).toContain('t-lama');
    expect([...tersisa, ...terkirim]).toContain('t-baru');
    // Dan pemangkasan hanya menyentuh yang benar-benar dikirim.
    expect(tersisa).not.toContain('t-lama');
  });

  it('ANTRE GANDA clientTxnId sama: menimpa, tidak menggandakan', async () => {
    const q = await bukaUlangAplikasi();
    q.enqueue(BID, struk('t-sama', 10000));
    q.enqueue(BID, struk('t-sama', 25000));
    const isi = JSON.parse(simpanan.mentah(KUNCI_ANTRIAN)!);
    expect(isi).toHaveLength(1);
    expect(isi[0].totalAmount).toBe(25000);   // yang terakhir menang
  });

  it('(d) ANTRIAN RUSAK di penyimpanan: tidak melempar, mulai bersih', async () => {
    const q = await bukaUlangAplikasi();
    q.enqueue(BID, struk('t-x'));
    simpanan.rusakkan(KUNCI_ANTRIAN);
    expect(() => q.getStatus(BID)).not.toThrow();
    expect(q.getStatus(BID).pending).toBe(0);
  });

  it('BATCH BESAR dipotong 200, sisanya menyusul', async () => {
    const q = await bukaUlangAplikasi();
    for (let i = 0; i < 250; i++) q.enqueue(BID, struk(`t${i}`));
    pasangServer(() => ({ ok: true }));

    await q.flush(TARGET);
    expect(fetchDipanggil[0].transactions).toHaveLength(200);
    // flush memanggil dirinya sendiri untuk sisanya.
    expect(fetchDipanggil[1].transactions).toHaveLength(50);
    expect(q.getStatus(BID).pending).toBe(0);
  });
});

/* ========================================================================== */

describe('KATEGORI (b): penyimpanan penuh — satu-satunya lubang keawetan', () => {

  it('penyimpanan penuh tidak lagi gagal diam-diam', async () => {
    const q = await bukaUlangAplikasi();
    const jejak = vi.spyOn(console, 'error').mockImplementation(() => {});

    simpanan.tolakTulis = true;
    const hasil = q.enqueue(BID, struk('t-hilang'));
    simpanan.tolakTulis = false;

    // Transaksinya memang TIDAK tersimpan — itu batas fisik perangkat, bukan
    // sesuatu yang bisa diakali kode.
    expect(simpanan.mentah(KUNCI_ANTRIAN)).toBeNull();
    expect(q.getStatus(BID).pending).toBe(0);
    expect(jejak).toHaveBeenCalled();

    // Tapi sekarang pemanggilnya TAHU, dan status yang dibaca Header
    // menyebutkannya — sebelumnya keduanya buta.
    expect(hasil).toBe(false);
    expect(q.getStatus(BID).lastError).toBe('PENYIMPANAN_PENUH');
  });

  it('penanda bertahan walau writeMeta ikut gagal', async () => {
    const q = await bukaUlangAplikasi();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    simpanan.tolakTulis = true;
    q.enqueue(BID, struk('t-x'));
    // Penyimpanan masih menolak: readMeta tidak akan pernah menemukan
    // penandanya. Yang menahannya adalah penanda di memori.
    expect(q.getStatus(BID).lastError).toBe('PENYIMPANAN_PENUH');
  });

  it('penanda hilang begitu penyimpanan lega kembali', async () => {
    const q = await bukaUlangAplikasi();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    simpanan.tolakTulis = true;
    q.enqueue(BID, struk('t-a'));
    expect(q.getStatus(BID).lastError).toBe('PENYIMPANAN_PENUH');

    simpanan.tolakTulis = false;
    expect(q.enqueue(BID, struk('t-b'))).toBe(true);
    expect(q.getStatus(BID).lastError).not.toBe('PENYIMPANAN_PENUH');
    expect(q.getStatus(BID).pending).toBe(1);
  });

  it('JALUR NORMAL tetap melaporkan berhasil', async () => {
    const q = await bukaUlangAplikasi();
    expect(q.enqueue(BID, struk('t-ok'))).toBe(true);
  });
});
