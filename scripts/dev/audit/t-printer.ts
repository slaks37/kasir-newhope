/**
 * STRUK YANG SEBENARNYA TERCETAK — encoder diuji terhadap decoder independen,
 * dan jalur LAN diuji terhadap printer tiruan.
 *
 * APA BEDANYA DARI t-peripheral.ts.
 *
 * Uji itu mencocokkan byte dengan konstanta yang diambil dari encoder yang
 * sama (`CMD.CUT(3)`, `CMD.DRAWER(0)`). Itu membuktikan encoder konsisten
 * dengan dirinya sendiri — dan akan tetap hijau kalau konstantanya sendiri
 * salah menurut spesifikasi.
 *
 * Di sini byte dibaca kembali oleh decoder yang ditulis dari spesifikasi Epson
 * secara terpisah (`escpos-decoder.mjs`). Yang diperiksa bukan lagi "apakah
 * encoder mengeluarkan byte yang saya harapkan", melainkan "apakah struk yang
 * SEBENARNYA TERCETAK sudah benar" — teksnya, urutannya, perataan, dan momen
 * laci terbuka.
 *
 * Bagian terakhir menjalankan printer TIRUAN yang menerima byte lewat HTTP,
 * persis seperti jembatan printer LAN. Itu menguji jalur transport yang
 * sungguhan dipakai `jalurLan`, bukan hanya fungsi pembangun byte.
 *
 * YANG TETAP TIDAK DIBUKTIKAN: bahwa printer merek tertentu menafsirkan byte
 * ini seperti spesifikasi mengatakannya. Itu menuntut perangkat keras.
 */
import http from 'node:http';
import { bangunStruk, bangunBukaLaci, LEBAR_KOLOM } from '../../../src/lib/peripheral/escpos';
import { jalurLan } from '../../../src/lib/peripheral/transport';
import { Spooler, petaSimpanan } from '../../../src/lib/peripheral/spooler';
import { bongkarEscPos, gambarStruk } from './escpos-decoder.mjs';

const line = console.log;
let gagal = 0;
const cek = (ok: boolean, pesan: string) => {
  if (ok) line(`     OK     ${pesan}`);
  else { gagal++; line(`     GAGAL  ${pesan}`); }
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
line('\n  1. Struk yang sebenarnya tercetak (dibaca decoder independen)');

const hasil = bongkarEscPos(bangunStruk(STRUK, '80mm', true));
line('');
line(gambarStruk(hasil, LEBAR_KOLOM['80mm']).split('\n').map((l) => '     ' + l).join('\n'));
line('');

const semua = hasil.teks.join('\n');
cek(semua.includes('Kopi Senja Kemang'), 'nama toko tercetak');
cek(semua.includes('INV-20260830-001'), 'nomor struk tercetak');
cek(semua.includes('Barista Andi'), 'nama kasir tercetak');
cek(semua.includes('Kopi Susu Gula Aren'), 'nama produk tercetak utuh, tidak terpotong');
cek(/2 x 22\.000/.test(semua), 'jumlah x harga satuan tercetak');
cek(/TOTAL\s+85\.840/.test(semua), 'total tercetak dengan pemisah ribuan');
cek(/Diskon\s+-5\.000/.test(semua), 'diskon tercetak sebagai pengurang');
cek(/Kembali\s+14\.160/.test(semua), 'kembalian tercetak');
cek(hasil.takDikenal.length === 0,
    `tidak ada byte yang tidak dikenali printer (${hasil.takDikenal.length})`);

// ---------------------------------------------------------------------------
line('\n  2. Perataan dan penekanan');

const kepala = hasil.baris.slice(0, 4);
cek(kepala.some((r) => r.teks.includes('Kopi Senja') && r.rata === 'tengah'),
    'nama toko rata TENGAH');
cek(hasil.baris.some((r) => /TOTAL/.test(r.teks) && r.tebal),
    'baris TOTAL dicetak TEBAL — yang paling dicari mata pelanggan');
cek(hasil.baris.some((r) => /INV-/.test(r.teks) && r.rata === 'kiri'),
    'rincian transaksi kembali rata kiri');

const barisTotal = hasil.baris.find((r) => /TOTAL/.test(r.teks));
cek(!!barisTotal && barisTotal.teks.trimEnd().endsWith('85.840'),
    'angka uang rata KANAN pada barisnya');

// ---------------------------------------------------------------------------
line('\n  3. Laci kasir dan potong kertas');

const laci = hasil.perintah.find((p: any) => p.nama === 'DRAWER') as any;
const potong = hasil.perintah.find((p: any) => p.nama === 'CUT') as any;
cek(!!laci, 'pulsa laci kasir ada di aliran byte');
cek(laci?.pin === 0, 'memakai pin 2 (m=0) — pin yang dipakai hampir semua laci');
cek(laci?.onMs === 50 && laci?.offMs === 500,
    `lama pulsa 50ms/500ms menurut spesifikasi (terbaca ${laci?.onMs}/${laci?.offMs})`);
cek(!!potong && potong.jenis === 'sebagian',
    'potong SEBAGIAN — struk menggantung, tidak jatuh ke lantai');
cek(laci?.posisi === 0,
    'laci dipulsa SEBELUM satu baris pun tercetak — kasir tidak menunggu printer');

const tanpaLaci = bongkarEscPos(bangunStruk(STRUK, '80mm', false));
cek(tanpaLaci.laciDibuka === false, 'tidak ada pulsa laci ketika tidak diminta');

const hanyaLaci = bongkarEscPos(bangunBukaLaci());
cek(hanyaLaci.laciDibuka && hanyaLaci.baris.length === 0,
    'buka laci tanpa mencetak satu baris pun');

// ---------------------------------------------------------------------------
line('\n  4. Kertas 58mm — struk sempit');

const sempit = bongkarEscPos(bangunStruk(STRUK, '58mm', false));
const terlaluPanjang = sempit.baris.filter((r) => r.teks.length > LEBAR_KOLOM['58mm']);
cek(terlaluPanjang.length === 0,
    `tidak ada baris melebihi 32 kolom (${terlaluPanjang.length} melanggar)`);
cek(sempit.teks.join('\n').includes('85.840'), 'total tetap tercetak utuh di kertas sempit');

// ---------------------------------------------------------------------------
line('\n  5. Printer TIRUAN lewat jalur LAN');

/*
 * Server ini berlaku seperti jembatan printer LAN: menerima byte mentah lewat
 * HTTP lalu membongkarnya. Yang diuji di sini adalah jalur transport yang
 * sungguhan dipakai `jalurLan` — termasuk header, bentuk body, dan penanganan
 * status — bukan hanya fungsi pembangun byte.
 */
const diterima: Uint8Array[] = [];
let balasStatus = 200;

const server = http.createServer((req, res) => {
  const potongan: Buffer[] = [];
  req.on('data', (c) => potongan.push(c));
  req.on('end', () => {
    if (balasStatus === 200) diterima.push(new Uint8Array(Buffer.concat(potongan)));
    res.writeHead(balasStatus).end();
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as any).port;
const url = `http://127.0.0.1:${port}/print`;

const spooler = new Spooler(jalurLan(url).kirim, {
  simpanan: petaSimpanan(), maksPercobaan: 2, jedaAwalMs: 1, tunggu: async () => {},
});
spooler.antre(bangunStruk(STRUK, '80mm', true), 'INV-20260830-001');
const h1 = await spooler.jalankan();

cek(h1.selesai === 1, 'struk terkirim ke printer lewat jaringan');
cek(diterima.length === 1, 'printer menerima tepat satu kiriman');

const diPrinter = bongkarEscPos(diterima[0]);
cek(diPrinter.teks.join('\n').includes('INV-20260830-001'),
    'byte yang SAMPAI DI PRINTER membongkar kembali ke struk yang benar');
cek(diPrinter.laciDibuka, 'laci kasir ikut terkirim lewat jaringan');
cek(diPrinter.kertasDipotong, 'perintah potong ikut terkirim');

// --- printer yang menolak ---
line('\n  6. Printer yang menolak (kertas habis / offline)');
balasStatus = 503;
spooler.bersihkan();
spooler.antre(bangunStruk(STRUK, '80mm', false), 'INV-GAGAL');
const h2 = await spooler.jalankan();
cek(h2.gagal === 1, 'penolakan printer dilaporkan sebagai gagal, bukan ditelan');
cek(spooler.daftar().some((j) => j.status === 'gagal' && j.keterangan === 'INV-GAGAL'),
    'struk yang gagal TETAP di antrian untuk dicetak ulang');

balasStatus = 200;
const diulang = spooler.ulangiYangGagal();
const h3 = await spooler.jalankan();
cek(diulang === 1 && h3.selesai === 1, 'tercetak setelah printer kembali normal');
cek(diterima.length === 2, 'printer menerima kiriman ulangnya');

await new Promise<void>((r) => server.close(() => r()));

line('\n  CATATAN: decoder ditulis dari spesifikasi Epson, TERPISAH dari encoder,');
line('  jadi yang dibandingkan adalah dua pembacaan spesifikasi yang berbeda.');
line('  Bahwa printer merek tertentu menafsirkannya seperti spesifikasi');
line('  mengatakannya TETAP menuntut perangkat keras, dan tidak dibuktikan');
line('  di sini.');

line(gagal === 0
  ? '\n  >>> LULUS: struk yang tercetak benar, dan sampai ke printer lewat jaringan.\n'
  : `\n  >>> ${gagal} MASALAH.\n`);
process.exit(gagal === 0 ? 0 : 1);
