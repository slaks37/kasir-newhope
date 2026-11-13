/** No payment tokens are persisted: only tenant-owner-scoped retry intent. */
export function checkoutRequestKey(owner: string | undefined, plan: string, cycle: string, extras: number): string {
  if (!owner) throw new Error('Sesi otentikasi diperlukan.');
  const key = `nhpos_billing_retry_v1_${owner}_${plan}_${cycle}_${extras}`;
  try {
    const prior = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (prior?.expires > Date.now() && /^[0-9a-f-]{36}$/i.test(prior.id)) return prior.id;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, JSON.stringify({id, expires: Date.now() + 86400000}));
    return id;
  } catch { throw new Error('Penyimpanan retry pembayaran tidak tersedia. Aktifkan penyimpanan browser.'); }
}
export function isDokuHostedUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      ['checkout.doku.com','jokul.doku.com','sandbox.doku.com'].includes(u.hostname);
  } catch { return false; }
}
export function isVerifiedInvoicePayment(value: any): boolean {
  return value?.ok === true && value?.paid === true && value?.invoice?.paymentStatus === 'PAID' &&
    value?.invoice?.reconciliationStatus === 'APPLIED';
}
export function paymentStatusNotice(status: string | undefined): string {
  return ({FAILED:'Percobaan pembayaran gagal. Periksa status sebelum mencoba kembali.',
    EXPIRED:'Tagihan kedaluwarsa. Jangan membayar kode lama; periksa status lalu buat tagihan baru.',
    CANCELLED:'Pembayaran dibatalkan. Langganan belum diperpanjang.',
    REFUNDED:'Pengembalian dana tercatat. Hubungi dukungan untuk peninjauan langganan.'} as Record<string,string>)[status || ''] ||
    'Pembayaran belum terkonfirmasi. Selesaikan pembayaran di DOKU, lalu periksa status kembali.';
}

export function forgetCheckoutRequestKey(owner: string | undefined, plan: string, cycle: string, extras: number): void {
  if(!owner) return;
  try { sessionStorage.removeItem(`nhpos_billing_retry_v1_${owner}_${plan}_${cycle}_${extras}`); } catch { /* verified ledger remains authoritative */ }
}

export type PaymentUiState='PAYMENT_NOT_STARTED'|'CHECKOUT_CREATING'|'AWAITING_PAYMENT'|'PAYMENT_VERIFYING'|'PAYMENT_SUCCESS'|'PAYMENT_FAILED'|'PAYMENT_EXPIRED'|'PAYMENT_REVIEW_REQUIRED'|'PAYMENT_UNAVAILABLE';
export function paymentUiState(value:any):PaymentUiState {
 if(value?.invoice?.reconciliationStatus==='REVIEW')return 'PAYMENT_REVIEW_REQUIRED';
 if(isVerifiedInvoicePayment(value))return 'PAYMENT_SUCCESS';
 if(value?.invoice?.paymentStatus==='EXPIRED')return 'PAYMENT_EXPIRED';
 if(['FAILED','CANCELLED'].includes(value?.invoice?.paymentStatus))return 'PAYMENT_FAILED';
 if(value?.invoice?.paymentStatus==='REFUNDED')return 'PAYMENT_REVIEW_REQUIRED';
 return value?.invoice?'AWAITING_PAYMENT':'PAYMENT_NOT_STARTED';
}
export const paymentStateLabels:Record<PaymentUiState,string>={
 PAYMENT_NOT_STARTED:'Belum ada pembayaran dimulai.',CHECKOUT_CREATING:'Menyiapkan tagihan dan halaman DOKU…',AWAITING_PAYMENT:'Menunggu konfirmasi pembayaran dari DOKU.',PAYMENT_VERIFYING:'Memeriksa bukti pembayaran…',PAYMENT_SUCCESS:'Pembayaran terverifikasi dan langganan aktif.',PAYMENT_FAILED:'Percobaan pembayaran belum berhasil. Tagihan belum dibayar.',PAYMENT_EXPIRED:'Tagihan berakhir. Jangan membayar tautan atau kode lama.',PAYMENT_REVIEW_REQUIRED:'Pembayaran perlu ditinjau dukungan. Jangan membayar ulang.',PAYMENT_UNAVAILABLE:'Pembayaran belum tersedia. Trial dan data usaha Anda tetap tersimpan.'};
export function paymentErrorMessage(code:string):string {
 if(code==='CHECKOUT_EXPIRED')return 'Tagihan berakhir. Hitung tagihan baru dan jangan membayar kode lama.';
 if(['CHECKOUT_PENDING_EXISTS','CHECKOUT_IN_PROGRESS_OR_NEEDS_REVIEW'].includes(code))return 'Masih ada tagihan yang perlu diperiksa. Buka riwayat pembayaran sebelum membuat tagihan lain.';
 if(['CHECKOUT_SCOPE_REVIEW_REQUIRED','PAYMENT_REVIEW_REQUIRED'].includes(code))return paymentStateLabels.PAYMENT_REVIEW_REQUIRED;
 if(code==='AUTHENTICATION_REQUIRED')return 'Silakan masuk kembali untuk melanjutkan pembayaran.';
 if(code==='CHECKOUT_QUOTE_CHANGED')return 'Langganan berubah. Muat ulang untuk menghitung tagihan terbaru.';
 return paymentStateLabels.PAYMENT_UNAVAILABLE;
}
