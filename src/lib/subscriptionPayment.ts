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
