/**
 * Presisi finansial — memakai src/lib/money.ts YANG SEBENARNYA.
 *
 * Sebelumnya berkas ini menyalin rumusnya. Salinan bisa benar sementara kodenya
 * salah, jadi sekarang modulnya diimpor langsung.
 */
import { hitungDiskonBaris, hitungKembalian, hitungTotal, rupiah } from '../../../src/lib/money.ts';
const line = console.log;
let gagal = 0;
const cek = (nama, nilai) => {
  const bulat = Number.isInteger(nilai);
  if (!bulat) gagal++;
  return `${String(nilai).padEnd(22)} ${bulat ? '' : '<-- PECAHAN'}`;
};

line('\n  A. Diskon persen yang tidak bulat');
for (const [h,q,p] of [[33333,1,10],[10000,3,33],[15750,2,15],[9999,7,12.5],[100,1,33.33]]) {
  const r = hitungDiskonBaris(h,q,p,0);
  line(`     ${String(h).padStart(6)} x${q} -${String(p).padEnd(5)} diskon ${cek('d',r.diskon)} neto ${cek('n',r.neto)}`);
}

line('\n  B. Diskon melebihi harga (tidak boleh jadi uang kembali)');
const lebih = hitungDiskonBaris(10000,1,150,0);
line(`     10.000 -150% -> diskon ${lebih.diskon}, neto ${lebih.neto}  ${lebih.neto===0?'':'<-- SALAH'}`);
if (lebih.neto !== 0) gagal++;

line('\n  C. Akumulasi ke subtotal, pajak 11%, service 5%');
const baris = [hitungDiskonBaris(33333,1,10,0), hitungDiskonBaris(10000,3,33,0), hitungDiskonBaris(15750,2,15,0)];
const t = hitungTotal({ subtotal: baris.reduce((s,x)=>s+x.neto,0),
  pakaiPajak:true, pajakPersen:11, pakaiService:true, servicePersen:5 });
line(`     subtotal    ${cek('s',t.subtotal)}`);
line(`     pajak 11%   ${cek('p',t.pajak)}`);
line(`     service 5%  ${cek('v',t.service)}`);
line(`     grand total ${cek('g',t.total)}`);

line('\n  D. Kembalian tunai');
const kembali = hitungKembalian(100000, t.total);
line(`     bayar 100.000 - total ${t.total} = ${cek('k',kembali)}`);
line(`     uang kurang: bayar 50.000 -> ${hitungKembalian(50000,t.total)} (tidak negatif)`);
if (hitungKembalian(50000,t.total) < 0) gagal++;

line('\n  E. Masukan rusak tidak boleh jadi NaN');
for (const buruk of [NaN, undefined, null, 'abc', Infinity]) {
  const r = rupiah(buruk);
  line(`     rupiah(${String(buruk).padEnd(9)}) = ${r} ${Number.isFinite(r)?'':'<-- NaN BOCOR'}`);
  if (!Number.isFinite(r)) gagal++;
}

line('\n  F. Baris struk harus menjumlah TEPAT ke totalnya');
const jumlahBaris = baris.reduce((s,x)=>s+x.neto,0);
const cocok = jumlahBaris === t.subtotal;
line(`     Σ baris = ${jumlahBaris}, subtotal = ${t.subtotal}  ${cocok?'cocok':'<-- SELISIH'}`);
if (!cocok) gagal++;

line(gagal===0 ? '\n  >>> LULUS: seluruh nilai uang bulat dan konsisten.\n'
               : `\n  >>> ${gagal} MASALAH presisi.\n`);
process.exit(gagal===0?0:1);
