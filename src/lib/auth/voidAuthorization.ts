/**
 * Bukti otorisasi pembatalan transaksi.
 *
 * KENAPA BUKAN PIN APA ADANYA.
 *
 * Void bisa terjadi saat internet mati, lalu menunggu di antrian sinkronisasi
 * di `localStorage` sampai perangkat tersambung lagi. Kalau yang diantrikan
 * adalah PIN manajer, PIN itu tergeletak di penyimpanan browser sampai
 * terkirim — bisa dibaca siapa pun yang membuka konsol peramban di terminal
 * itu, dan yang lebih buruk, bisa diketik ulang di terminal mana pun.
 *
 * Bukti ini menggantikannya. Ia diturunkan dari hash PIN yang MEMANG SUDAH ADA
 * di perangkat (`User.pin` sudah tersimpan sebagai `sha256$salt$hash`), dan
 * diikat ke satu `clientTxnId`. Server menghitung ulang dengan hash yang
 * tersimpan di `internal.memberships.pin_hash` dan membandingkannya.
 *
 * Yang mencuri bukti dari antrian hanya bisa membatalkan transaksi yang memang
 * sudah dibatalkan.
 */

/** sha256(`<pinHash>:<clientTxnId>`) — sama persis dengan sisi server. */
export async function buatBuktiOtorisasi(pinHash: string, clientTxnId: string): Promise<string> {
  const data = new TextEncoder().encode(`${pinHash}:${clientTxnId}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
