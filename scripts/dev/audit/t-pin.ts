/**
 * PIN STAF — hash klien harus cocok dengan verifikasi server.
 *
 * CACAT YANG DITUTUP.
 *
 * `sha256()` di sisi klien punya cadangan non-kriptografis: hash FNV 64-bit
 * berawalan `fallback_`, dipakai ketika `crypto.subtle` tidak ada. Dua
 * akibatnya, dan keduanya buruk:
 *
 *   1. ia BUKAN pengaman. 64 bit non-kriptografis atas PIN empat angka bisa
 *      dibalik seketika. Ia hanya TERLIHAT seperti hash.
 *
 *   2. server TIDAK AKAN PERNAH mencocokkannya. services/pos/staff.ts
 *      memverifikasi dengan SHA-256 sungguhan, jadi staf yang didaftarkan dari
 *      perangkat itu menyimpan `sha256$<salt>$<bukan sha256>` — PIN-nya tidak
 *      pernah cocok, dengan pesan "PIN salah" yang berbohong kepada manajer
 *      yang mengetiknya dengan benar.
 *
 * Salt-nya juga jatuh ke `Math.random()`, yang bisa ditebak — meniadakan
 * gunanya salt, karena penyerang cukup menghitung tabel 10.000 PIN sekali lalu
 * memakainya untuk semua staf.
 *
 * Uji ini memeriksa bahwa rumus kedua sisi SUNGGUH sama, bukan kebetulan mirip.
 */
import crypto from 'node:crypto';
import { hashPin, verifyPinHash, generateSalt, KriptoTidakTersedia } from '../../../src/lib/auth/pinSecurity';

const line = console.log;
let gagal = 0;
const cek = (ok: boolean, pesan: string) => {
  if (ok) line(`     OK     ${pesan}`);
  else { gagal++; line(`     GAGAL  ${pesan}`); }
};

/** Verifikasi ala SERVER — ditulis ulang di sini, tidak diimpor dari klien. */
function verifikasiAlaServer(pin: string, tersimpan: string): boolean {
  const bagian = tersimpan.split('$');
  if (bagian.length !== 3 || bagian[0] !== 'sha256') return false;
  const [, salt, harapan] = bagian;
  const dihitung = crypto.createHash('sha256').update(`${pin}:${salt}`).digest('hex');
  return dihitung === harapan;
}

line('\n  1. Hash klien cocok dengan verifikasi server');
{
  const tersimpan = await hashPin('4821');
  line(`     ${tersimpan.slice(0, 46)}…`);
  cek(/^sha256\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(tersimpan),
      'bentuknya sha256$<salt 32 hex>$<hash 64 hex>');
  cek(verifikasiAlaServer('4821', tersimpan),
      'server MENERIMA PIN yang benar — rumus kedua sisi sungguh sama');
  cek(!verifikasiAlaServer('1111', tersimpan), 'server menolak PIN yang salah');
  cek(await verifyPinHash('4821', tersimpan), 'klien juga menerima PIN yang benar');
  cek(!(await verifyPinHash('1111', tersimpan)), 'klien menolak PIN yang salah');
}

line('\n  2. Salt berbeda setiap kali');
{
  const a = await hashPin('1234');
  const b = await hashPin('1234');
  cek(a !== b, 'PIN yang SAMA menghasilkan hash berbeda — salt bekerja');
  cek(a.split('$')[1] !== b.split('$')[1], 'salt-nya sendiri berbeda');
  cek(verifikasiAlaServer('1234', a) && verifikasiAlaServer('1234', b),
      'keduanya tetap diverifikasi server');

  const salts = new Set(Array.from({ length: 200 }, () => generateSalt()));
  cek(salts.size === 200, `200 salt, tidak ada yang berulang (${salts.size})`);
}

line('\n  3. Tanpa Web Crypto: GAGAL, bukan menghasilkan hash palsu');
{
  const asli = globalThis.crypto;
  try {
    // @ts-expect-error — sengaja dihilangkan untuk meniru peramban tanpa Web Crypto.
    delete globalThis.crypto;

    let pesanSalt = '';
    try { generateSalt(); } catch (e) { pesanSalt = (e as Error).name; }
    cek(pesanSalt === 'KriptoTidakTersedia',
        'generateSalt MELEMPAR alih-alih memakai Math.random()');

    let pesanHash = '';
    try { await hashPin('4821'); } catch (e) { pesanHash = (e as Error).name; }
    cek(pesanHash === 'KriptoTidakTersedia',
        'hashPin MELEMPAR alih-alih menghasilkan hash `fallback_` palsu');
  } finally {
    globalThis.crypto = asli;
  }
}

line('\n  4. Hash palsu versi lama tidak akan pernah diterima server');
{
  // Bentuk yang DULU dihasilkan cadangan: awalan sha256$, isi bukan sha256.
  const palsu = 'sha256$0011223344556677$fallback_deadbeefcafe';
  cek(!verifikasiAlaServer('4821', palsu),
      'server menolaknya — inilah "PIN salah" yang membingungkan itu');
  cek(!(await verifyPinHash('4821', palsu)), 'klien pun menolaknya');
}

line('\n  5. Bukti otorisasi void terikat pada satu transaksi');
{
  const pinHash = await hashPin('4821');
  const bukti = (h: string, txn: string) =>
    crypto.createHash('sha256').update(`${h}:${txn}`).digest('hex');
  const a = bukti(pinHash, 'INV-001');
  const b = bukti(pinHash, 'INV-002');
  cek(a !== b, 'bukti untuk transaksi berbeda TIDAK sama — tidak bisa dipakai ulang');
  cek(a === bukti(pinHash, 'INV-001'), 'bukti untuk transaksi yang sama dapat direproduksi');
}

line(gagal === 0
  ? '\n  >>> LULUS: rumus PIN klien dan server sama, dan gagal-terang tanpa kripto.\n'
  : `\n  >>> ${gagal} MASALAH.\n`);
process.exit(gagal === 0 ? 0 : 1);
