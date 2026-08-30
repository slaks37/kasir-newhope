/**
 * KEBERHASILAN YANG BOHONG MENGHAPUS DATA.
 *
 * CACATNYA, dan kenapa ia yang paling parah dari seluruh temuan.
 *
 * Permukaan serverless (`api/_gateway.ts`) menjawab `{ ok: true, synced: true }`
 * untuk SETIAP `/api/v1/sync/*` tanpa menulis apa pun ke mana pun. Rantai
 * lengkapnya:
 *
 *   1. kasir menyinkronkan antrian transaksinya
 *   2. permukaan itu menjawab ok: true
 *   3. klien melihat ok, lalu MENGHAPUS transaksi itu dari antriannya
 *   4. transaksinya hilang dari kedua sisi
 *
 * Dan ia menyala tepat pada saat terburuk: blok itu adalah jalur CADANGAN
 * ketika gateway sungguhan tidak terjangkau. Penjualan mulai lenyap persis
 * ketika backend sedang bermasalah, tanpa satu pun pesan kesalahan, karena
 * semua pihak mengira semuanya baik-baik saja.
 *
 * Prinsip yang diuji di sini: KEGAGALAN YANG JUJUR MENYIMPAN DATANYA,
 * KEBERHASILAN YANG BOHONG MENGHAPUSNYA. Antrian sinkronisasi adalah
 * satu-satunya tempat di seluruh aplikasi yang menghapus catatan penjualan,
 * jadi ia hanya boleh melakukannya atas pengakuan yang sungguh-sungguh.
 */
import { enqueue, flush, getStatus, type SyncPayloadTxn } from '../../../src/lib/sync/queue';

const line = console.log;
let gagal = 0;
const cek = (ok: boolean, pesan: string) => {
  if (ok) line(`     OK     ${pesan}`);
  else { gagal++; line(`     GAGAL  ${pesan}`); }
};

/** localStorage tiruan: modul antrian menulis ke sana secara langsung. */
const peta = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => peta.get(k) ?? null,
  setItem: (k: string, v: string) => { peta.set(k, v); },
  removeItem: (k: string) => { peta.delete(k); },
  key: (i: number) => [...peta.keys()][i] ?? null,
  get length() { return peta.size; },
};

const target = {
  businessId: 'usr-uji_FNB',
  sector: 'FNB' as const,
  storeName: 'Warung Uji',
  ownerRef: 'usr-uji',
};

const txn = (id: string): SyncPayloadTxn => ({
  clientTxnId: id,
  invoiceNumber: id,
  cashierName: 'Kasir Uji',
  subtotal: 25000,
  discountAmount: 0,
  taxAmount: 2750,
  serviceChargeAmount: 0,
  totalAmount: 27750,
  paymentMethod: 'CASH',
  paymentStatus: 'COMPLETED',
  items: [{ productName: 'Kopi', unitPrice: 25000, quantity: 1, totalPrice: 25000 }],
} as SyncPayloadTxn);

/** Mengganti fetch dengan jawaban tertentu, lalu menghitung sisa antrian. */
async function dengan(jawaban: { status: number; body: unknown }, label: string) {
  peta.clear();
  enqueue(target.businessId, txn('INV-1'));
  enqueue(target.businessId, txn('INV-2'));
  const sebelum = getStatus(target.businessId).pending;

  (globalThis as any).fetch = async () => ({
    ok: jawaban.status >= 200 && jawaban.status < 300,
    status: jawaban.status,
    json: async () => jawaban.body,
  });

  await flush(target);
  const sesudah = getStatus(target.businessId).pending;
  line(`     ${label}`);
  line(`       antrian ${sebelum} -> ${sesudah}`);
  return sesudah;
}

// --- 1. Permukaan yang berbohong ------------------------------------------
line('\n  1. Jawaban "berhasil" TANPA pengakuan (cacat aslinya)');
{
  const sisa = await dengan(
    { status: 200, body: { ok: true, synced: true, message: 'Sync catalog ready' } },
    'server menjawab { ok: true, synced: true } tanpa menulis apa pun'
  );
  cek(sisa === 2, 'transaksi TETAP di antrian — tidak dibuang atas jawaban yang tidak mengakui apa pun');
}

// --- 2. Permukaan yang jujur gagal ----------------------------------------
line('\n  2. Jawaban 503 yang jujur');
{
  const sisa = await dengan(
    { status: 503, body: { ok: false, error: 'SYNC_UNAVAILABLE' } },
    'server menjawab 503 SYNC_UNAVAILABLE'
  );
  cek(sisa === 2, 'transaksi tetap aman di antrian, akan dikirim ulang nanti');
}

// --- 3. Server sungguhan yang menerima ------------------------------------
line('\n  3. Server sungguhan yang MENGAKUI');
{
  const sisa = await dengan(
    { status: 200, body: { ok: true, accepted: 2, voided: 0, skipped: 0 } },
    'server menjawab accepted: 2'
  );
  cek(sisa === 0, 'antrian dipangkas — inilah satu-satunya keadaan yang boleh menghapus');
}

// --- 4. Putar ulang ---------------------------------------------------------
line('\n  4. Kiriman yang diputar ulang (idempotensi)');
{
  const sisa = await dengan(
    { status: 200, body: { ok: true, replayed: true } },
    'server menjawab replayed: true'
  );
  cek(sisa === 0,
      'replay JUGA memangkas — kiriman ini memang sudah tercatat sebelumnya');
}

// --- 5. Semua dilewati -------------------------------------------------------
line('\n  5. Seluruh baris dilewati server');
{
  const sisa = await dengan(
    { status: 200, body: { ok: true, accepted: 0, skipped: 2 } },
    'server menjawab skipped: 2'
  );
  cek(sisa === 0,
      'dilewati tetap berarti diproses — server melihatnya dan memutuskan');
}

// --- 6. Jaringan putus -------------------------------------------------------
line('\n  6. Jaringan putus di tengah');
{
  peta.clear();
  enqueue(target.businessId, txn('INV-1'));
  (globalThis as any).fetch = async () => { throw new Error('network down'); };
  await flush(target);
  const sisa = getStatus(target.businessId).pending;
  line(`       antrian 1 -> ${sisa}`);
  cek(sisa === 1, 'kegagalan jaringan tidak pernah memakan transaksi');
}

line(gagal === 0
  ? '\n  >>> LULUS: antrian hanya dipangkas atas pengakuan yang sungguh-sungguh.\n'
  : `\n  >>> ${gagal} MASALAH.\n`);
process.exit(gagal === 0 ? 0 : 1);
