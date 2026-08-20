/**
 * Klien DOKU Checkout (non-SNAP / Jokul).
 *
 * SATU BERKAS untuk seluruh percakapan dengan DOKU. Kalau kelak Direct API
 * QRIS diaktifkan di akun dan QR-nya mau digambar di dalam aplikasi, yang
 * berubah hanya `buatPembayaran()` di sini — endpoint notifikasi, faktur, dan
 * aktivasi langganan tidak ikut tersentuh.
 *
 * PILIHAN Checkout, bukan Direct API: DOKU yang menampilkan halaman pembayaran
 * berikut QRIS-nya, dan DOKU pula yang mengurus masa berlaku QR, percobaan
 * ulang, serta metode lain (VA, e-wallet, kartu). Semuanya sudah jalan dengan
 * Client ID dan Secret Key yang ada, tanpa aktivasi produk tambahan.
 */

import { buatTandaTangan, stempelWaktu } from '../../src/server/dokuSignature.js';
import { randomUUID } from 'node:crypto';

const HOST_SANDBOX = 'https://api-sandbox.doku.com';
const HOST_PRODUKSI = 'https://api.doku.com';

const JALUR_CHECKOUT = '/checkout/v1/payment';

export interface KonfigurasiDoku {
  clientId: string;
  secretKey: string;
  produksi: boolean;
}

/**
 * Konfigurasi dari environment.
 *
 * Mengembalikan null kalau belum lengkap, bukan melempar — pemanggil yang
 * memutuskan bagaimana menyampaikannya. Layar langganan yang menampilkan
 * "pembayaran belum dikonfigurasi" jauh lebih berguna daripada 500 tanpa
 * penjelasan.
 *
 * PRODUKSI DITENTUKAN SECARA EKSPLISIT, bukan disimpulkan dari NODE_ENV.
 * Menyimpulkannya berarti satu variabel yang lupa diset mengirim pembayaran
 * sungguhan ke sandbox — merchant merasa sudah bayar, uangnya tidak pernah ada.
 */
export function konfigurasi(): KonfigurasiDoku | null {
  const clientId = process.env.DOKU_CLIENT_ID?.trim();
  const secretKey = process.env.DOKU_SECRET_KEY?.trim();
  if (!clientId || !secretKey) return null;
  return { clientId, secretKey, produksi: process.env.DOKU_ENV?.trim() === 'production' };
}

export function host(cfg: KonfigurasiDoku): string {
  return cfg.produksi ? HOST_PRODUKSI : HOST_SANDBOX;
}

export interface PermintaanPembayaran {
  /** Nomor faktur KITA. DOKU mengembalikannya di notifikasi. */
  invoiceNumber: string;
  /** Rupiah penuh, tanpa desimal — DOKU menolak pecahan pada IDR. */
  amount: number;
  /** Halaman yang dibuka setelah pelanggan selesai membayar. */
  callbackUrl: string;
  namaPaket: string;
  merchant: { id: string; name: string; email?: string | null };
  /** Menit sebelum QR kedaluwarsa. DOKU menerima 5–1440. */
  kedaluwarsaMenit?: number;
}

export interface HasilPembayaran {
  ok: boolean;
  paymentUrl?: string;
  tokenId?: string;
  expiredDate?: string;
  /** Pesan untuk dicatat di log kita, bukan untuk ditampilkan ke merchant. */
  detail?: string;
}

/**
 * Membuat sesi pembayaran. Mengembalikan URL halaman DOKU berisi QRIS.
 *
 * Tidak pernah melempar — kegagalan jaringan ke pihak ketiga adalah keadaan
 * yang wajar, bukan kejadian luar biasa, dan layar langganan harus bisa
 * menyampaikannya dengan tenang.
 */
export async function buatPembayaran(
  cfg: KonfigurasiDoku,
  p: PermintaanPembayaran
): Promise<HasilPembayaran> {
  // IDR tidak punya satuan pecahan di praktik, dan DOKU menolak desimal.
  const jumlah = Math.round(p.amount);
  if (!Number.isFinite(jumlah) || jumlah <= 0) {
    return { ok: false, detail: 'Nominal tidak sah.' };
  }

  const badan = JSON.stringify({
    order: {
      amount: jumlah,
      invoice_number: p.invoiceNumber,
      currency: 'IDR',
      callback_url: p.callbackUrl,
      line_items: [
        { name: p.namaPaket, price: jumlah, quantity: 1 },
      ],
    },
    payment: {
      payment_due_date: Math.min(1440, Math.max(5, p.kedaluwarsaMenit ?? 60)),
    },
    customer: {
      id: p.merchant.id.slice(0, 64),
      name: p.merchant.name.slice(0, 128),
      ...(p.merchant.email ? { email: p.merchant.email.slice(0, 128) } : {}),
    },
  });

  const requestId = randomUUID();
  const timestamp = stempelWaktu();

  const tandaTangan = buatTandaTangan({
    clientId: cfg.clientId,
    requestId,
    requestTimestamp: timestamp,
    requestTarget: JALUR_CHECKOUT,
    body: badan,
    secretKey: cfg.secretKey,
  });

  try {
    const res = await fetch(`${host(cfg)}${JALUR_CHECKOUT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': cfg.clientId,
        'Request-Id': requestId,
        'Request-Timestamp': timestamp,
        Signature: tandaTangan,
      },
      body: badan,
      // Merchant sedang menunggu di depan layar. Menggantung 30 detik lebih
      // buruk daripada memberi tahu bahwa gateway sedang tidak menjawab.
      signal: AbortSignal.timeout(15_000),
    });

    const teks = await res.text();
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}: ${teks.slice(0, 400)}` };
    }

    const d = JSON.parse(teks);
    const url = d?.response?.payment?.url;
    if (!url) {
      return { ok: false, detail: `Balasan tanpa payment.url: ${teks.slice(0, 400)}` };
    }

    return {
      ok: true,
      paymentUrl: String(url),
      tokenId: d?.response?.payment?.token_id ? String(d.response.payment.token_id) : undefined,
      expiredDate: d?.response?.payment?.expired_date
        ? String(d.response.payment.expired_date)
        : undefined,
    };
  } catch (err: any) {
    return { ok: false, detail: err?.name === 'TimeoutError' ? 'Gateway tidak menjawab.' : String(err?.message ?? err) };
  }
}

/* -------------------------------------------------------------------------- */
/* NOTIFIKASI                                                                  */
/* -------------------------------------------------------------------------- */

export interface NotifikasiDoku {
  invoiceNumber: string | null;
  /** SUCCESS | PENDING | FAILED | EXPIRED, apa adanya dari DOKU. */
  status: string;
  amount: number | null;
  /** QRIS, VIRTUAL_ACCOUNT, EMONEY, ... — untuk dicatat, bukan untuk keputusan. */
  channel: string | null;
  acquirer: string | null;
}

/**
 * Membaca badan notifikasi.
 *
 * Setiap medan dicari di lebih dari satu tempat: bentuk notifikasi DOKU berbeda
 * sedikit antar-kanal pembayaran, dan sebuah QRIS yang gagal terbaca karena
 * nama medannya bergeser satu tingkat berarti pembayaran yang tidak pernah
 * mengaktifkan apa pun.
 */
export function bacaNotifikasi(body: any): NotifikasiDoku {
  const b = body ?? {};
  const invoiceNumber =
    b.order?.invoice_number ?? b.transaction?.invoice_number ?? b.invoice_number ?? null;

  const status = String(
    b.transaction?.status ?? b.status ?? b.transaction_status ?? 'UNKNOWN'
  ).toUpperCase();

  const amountMentah = b.order?.amount ?? b.transaction?.amount ?? b.amount;
  const amount = amountMentah == null ? null : Number(amountMentah);

  return {
    invoiceNumber: invoiceNumber == null ? null : String(invoiceNumber),
    status,
    amount: Number.isFinite(amount as number) ? (amount as number) : null,
    channel: b.channel?.id ? String(b.channel.id) : b.service?.id ? String(b.service.id) : null,
    acquirer: b.acquirer?.id ? String(b.acquirer.id) : null,
  };
}

/** Status yang berarti uangnya benar-benar sudah diterima. */
export function pembayaranBerhasil(status: string): boolean {
  return status === 'SUCCESS' || status === 'SUCCESSFUL' || status === 'PAID';
}
