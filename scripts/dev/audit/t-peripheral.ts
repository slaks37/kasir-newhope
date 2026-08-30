/**
 * PERIPHERAL: ESC/POS, laci kasir, dan antrian cetak.
 *
 * APA YANG DIBUKTIKAN UJI INI, dan apa yang TIDAK.
 *
 * DIBUKTIKAN: byte perintahnya benar menurut spesifikasi ESC/POS, laci kasir
 * mendapat pulsa pada saat yang tepat, teks non-ASCII tidak merusak struk,
 * angka rupiah rata kanan, dan antrian cetak berperilaku benar saat printer
 * menggantung, gagal, lalu pulih.
 *
 * TIDAK DIBUKTIKAN: bahwa printer merek tertentu sungguh mencetak. Itu menuntut
 * perangkat keras. Uji ini memeriksa byte yang DIKIRIM, bukan kertas yang
 * keluar — dan mengatakannya, alih-alih membiarkan "peripheral: LULUS"
 * terbaca sebagai janji yang tidak ia tanggung.
 */
import {
  CMD, LEBAR_KOLOM, bangunStruk, bangunBukaLaci, keAscii, barisKiriKanan, bungkus,
} from '../../../src/lib/peripheral/escpos';
import { Spooler, petaSimpanan, batasiWaktu } from '../../../src/lib/peripheral/spooler';

const line = console.log;
let gagal = 0;
const cek = (ok: boolean, pesan: string) => {
  if (ok) line(`     OK     ${pesan}`);
  else { gagal++; line(`     GAGAL  ${pesan}`); }
};

/** Mencari deretan byte di dalam byte lain. */
const memuat = (hay: Uint8Array, needle: readonly number[]): boolean => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};
const posisi = (hay: Uint8Array, needle: readonly number[]): number => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
};

const STRUK = {
  namaToko: 'Kopi Senja Kemang',
  alamat: 'Jl. Kemang Raya No. 45, Jakarta Selatan',
  telepon: '0812-3456-7890',
  nomorStruk: 'INV-20260830-001',
  tanggal: '30 Agu 2026, 14:22',
  kasir: 'Barista Andi',
  items: [
    { nama: 'Kopi Susu Gula Aren', jumlah: 2, hargaSatuan: 22000, total: 44000 },
    { nama: 'Croissant Almond', jumlah: 1, hargaSatuan: 35000, total: 35000 },
  ],
  subtotal: 79000,
  diskon: 5000,
  pajak: 8140,
  serviceCharge: 3700,
  total: 85840,
  metodePembayaran: 'TUNAI',
  tunaiDiterima: 100000,
  kembalian: 14160,
};

// ---------------------------------------------------------------------------
line('\n  1. Perintah ESC/POS');

const bytes = bangunStruk(STRUK, '80mm', true);
cek(bytes[0] === 0x1b && bytes[1] === 0x40, 'struk diawali ESC @ (inisialisasi printer)');
cek(memuat(bytes, CMD.CUT(3)), 'perintah potong kertas ada (GS V 66)');
cek(memuat(bytes, [0x1d, 0x56, 66]), 'potongnya SEBAGIAN, bukan penuh — struk tidak jatuh ke lantai');
cek(memuat(bytes, CMD.ALIGN(1)) && memuat(bytes, CMD.ALIGN(0)), 'perataan tengah dan kiri dipakai');
cek(memuat(bytes, CMD.BOLD(true)) && memuat(bytes, CMD.BOLD(false)), 'tebal dinyalakan dan DIMATIKAN lagi');

// ---------------------------------------------------------------------------
line('\n  2. Laci kasir');

const laci = CMD.DRAWER(0);
cek(memuat(bytes, laci), 'pulsa laci kasir dikirim saat bukaLaci=true');
cek(!memuat(bangunStruk(STRUK, '80mm', false), laci), 'TIDAK dikirim saat bukaLaci=false');
cek(posisi(bytes, laci) < posisi(bytes, CMD.CUT(3)),
    'laci terbuka SEBELUM kertas dipotong — kasir mengambil kembalian, bukan menunggu');
const hanyaLaci = bangunBukaLaci();
cek(hanyaLaci.length === 7 && memuat(hanyaLaci, laci), 'buka laci tanpa mencetak apa pun');
cek(laci[3] === 25 && laci[4] === 250,
    'lama pulsa 50ms/500ms — cukup menarik solenoid, tidak memanaskan kumparan');

// ---------------------------------------------------------------------------
line('\n  3. Teks: printer termal bukan UTF-8');

cek(keAscii('Kopi “Senja” – enak…') === 'Kopi "Senja" - enak...',
    'tanda baca tipografis hasil salin-tempel diterjemahkan');
cek(keAscii('Cafe Ø') === 'Cafe ?', 'karakter di luar ASCII jadi "?", bukan dibuang diam-diam');
const strukAneh = bangunStruk({ ...STRUK, namaToko: 'Kafé “Böse” Ø' }, '58mm', false);
cek(strukAneh.every((b) => b <= 0x7f), 'tidak ada byte di atas 0x7F yang lolos ke printer');

// ---------------------------------------------------------------------------
line('\n  4. Tata letak');

const l80 = LEBAR_KOLOM['80mm'];
const l58 = LEBAR_KOLOM['58mm'];
cek(l80 === 48 && l58 === 32, 'lebar kolom sesuai standar Font A (48 / 32)');

const br = barisKiriKanan('Subtotal', '79.000', l80);
cek(br.length === l80, 'baris pas selebar kertas');
cek(br.endsWith('79.000'), 'angka uang rata kanan');

const panjang = barisKiriKanan('Nama Produk Yang Panjang Sekali Sampai Tidak Muat', '1.250.000', l58);
cek(panjang.length === l58 && panjang.endsWith('1.250.000'),
    'nama panjang yang dipotong, BUKAN angkanya');

const w = bungkus('Jl. Kemang Raya No. 45, Jakarta Selatan 12730', l58);
cek(w.every((b) => b.length <= l58), 'pembungkusan tidak melebihi lebar kertas');
cek(w.join(' ').includes('Kemang'), 'tidak ada kata yang hilang saat dibungkus');

// ---------------------------------------------------------------------------
line('\n  5. Antrian cetak: printer yang MENGGANTUNG');

{
  // Printer Bluetooth yang terputus tidak mengembalikan kesalahan — ia diam.
  const menggantung = () => new Promise<void>(() => {});
  const mulai = Date.now();
  let pesan = '';
  try {
    await batasiWaktu(menggantung(), 120, 'printer tidak menjawab');
  } catch (e) { pesan = (e as Error).message; }
  const lama = Date.now() - mulai;
  cek(pesan === 'printer tidak menjawab', 'pengiriman yang menggantung dipotong batas waktu');
  cek(lama < 1000, `layar kasir tidak ikut menggantung (${lama} ms)`);
}

// ---------------------------------------------------------------------------
line('\n  6. Antrian cetak: gagal, coba lagi, lalu menyerah');

{
  let panggilan = 0;
  const selaluGagal = async () => { panggilan++; throw new Error('kertas habis'); };
  const sp = new Spooler(selaluGagal, {
    simpanan: petaSimpanan(), maksPercobaan: 3, jedaAwalMs: 1, tunggu: async () => {},
  });
  sp.antre(bangunStruk(STRUK, '80mm', false), 'INV-001');
  const hasil = await sp.jalankan();

  cek(panggilan === 3, `dicoba tepat 3 kali, bukan sekali dan bukan tak terhingga (${panggilan})`);
  cek(hasil.gagal === 1, 'dilaporkan gagal');
  const rows = sp.daftar();
  cek(rows.length === 1 && rows[0].status === 'gagal',
      'pekerjaan gagal TIDAK dibuang — kasir harus bisa melihat dan mencetak ulang');
  cek(rows[0].kesalahanTerakhir === 'kertas habis', 'sebab kegagalan tersimpan apa adanya');
}

// ---------------------------------------------------------------------------
line('\n  7. Antrian cetak: pulih setelah kertas diganti');

{
  let kertasAda = false;
  const kadang = async () => { if (!kertasAda) throw new Error('kertas habis'); };
  const sp = new Spooler(kadang, {
    simpanan: petaSimpanan(), maksPercobaan: 2, jedaAwalMs: 1, tunggu: async () => {},
  });
  sp.antre(bangunStruk(STRUK, '80mm', false), 'INV-002');
  sp.antre(bangunStruk(STRUK, '58mm', false), 'INV-003');
  await sp.jalankan();
  cek(sp.ringkasan().gagal === 2, 'kedua struk gagal saat kertas habis');

  kertasAda = true;
  const diulang = sp.ulangiYangGagal();
  cek(diulang === 2, 'tombol cetak ulang mengembalikan keduanya ke antrian');
  const kedua = await sp.jalankan();
  cek(kedua.selesai === 2, 'keduanya tercetak setelah kertas diganti');
  cek(sp.ringkasan().gagal === 0, 'tidak ada yang tertinggal dalam keadaan gagal');
  cek(sp.bersihkan() === 2, 'yang selesai dibersihkan');
}

// ---------------------------------------------------------------------------
line('\n  8. Antrian bertahan setelah tablet dimuat ulang');

{
  const simpanan = petaSimpanan();
  const sp1 = new Spooler(async () => { throw new Error('bluetooth terputus'); },
    { simpanan, maksPercobaan: 1, jedaAwalMs: 1, tunggu: async () => {} });
  sp1.antre(bangunStruk(STRUK, '80mm', false), 'INV-004');
  await sp1.jalankan();

  // Tablet dimuat ulang: instance baru, penyimpanan yang sama.
  const sp2 = new Spooler(async () => {}, { simpanan, jedaAwalMs: 1, tunggu: async () => {} });
  cek(sp2.daftar().length === 1, 'struk yang belum tercetak masih ada setelah muat ulang');
  sp2.ulangiYangGagal();
  const h = await sp2.jalankan();
  cek(h.selesai === 1, 'dan bisa dicetak oleh instance yang baru');
}

// ---------------------------------------------------------------------------
line('\n  9. Dua penjalan bersamaan tidak mencetak dobel');

{
  let terkirim = 0;
  const lambat = async () => { await new Promise((r) => setTimeout(r, 30)); terkirim++; };
  const sp = new Spooler(lambat, { simpanan: petaSimpanan(), jedaAwalMs: 1, tunggu: async () => {} });
  sp.antre(bangunStruk(STRUK, '80mm', false), 'INV-005');
  const [a, b] = await Promise.all([sp.jalankan(), sp.jalankan()]);
  cek(terkirim === 1, `struk dikirim sekali, bukan dua kali (${terkirim})`);
  cek(a.selesai + b.selesai === 1, 'hanya satu penjalan yang mengerjakannya');
}

line('\n  CATATAN: uji ini memeriksa BYTE YANG DIKIRIM dan perilaku antrian.');
line('  Bahwa printer merek tertentu sungguh mencetak menuntut perangkat keras');
line('  dan TIDAK dibuktikan di sini.');

line(gagal === 0
  ? '\n  >>> LULUS: perintah ESC/POS benar, laci kasir tepat waktu, antrian tahan gagal.\n'
  : `\n  >>> ${gagal} MASALAH.\n`);
process.exit(gagal === 0 ? 0 : 1);
