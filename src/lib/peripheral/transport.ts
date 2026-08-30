/**
 * JALUR KE PRINTER — Bluetooth, USB, LAN, atau dialog browser.
 *
 * APA YANG SUNGGUH-SUNGGUH BEKERJA, DAN APA YANG TIDAK.
 *
 * Berkas ini sengaja memisahkan yang bisa diuji dari yang tidak, karena tanpa
 * pemisahan itu tidak ada yang tahu bagian mana yang sudah terbukti:
 *
 *   BISA DIUJI TANPA PERANGKAT KERAS   pemilihan jalur, penanganan kegagalan,
 *   dan seluruh isi src/lib/peripheral/escpos.ts (byte-nya diperiksa satu per
 *   satu di scripts/dev/audit/t-peripheral.ts).
 *
 *   TIDAK BISA                          apakah printer Bluetooth merek tertentu
 *   sungguh mencetak. Itu menuntut printer sungguhan, dan tidak ada uji di
 *   repositori ini yang boleh mengaku sudah membuktikannya.
 *
 * Web Bluetooth dan WebUSB hanya tersedia di Chromium pada konteks aman
 * (HTTPS atau localhost), dan HANYA setelah pengguna memilih perangkatnya
 * sendiri lewat dialog browser — tidak ada cara memindai diam-diam. Di Safari
 * dan Firefox keduanya tidak ada sama sekali. Karena itu `dukungan()` di bawah
 * melaporkan apa adanya, dan aplikasi wajib menampilkannya alih-alih
 * menjanjikan sesuatu yang tidak bisa ia lakukan di peramban tersebut.
 */

/** Service/characteristic UUID yang dipakai mayoritas printer termal Bluetooth. */
const BT_SERVICE = '000018f0-0000-1000-8000-00805f9b34fb';
const BT_CHAR = '00002af1-0000-1000-8000-00805f9b34fb';

/** Ukuran potongan kirim. Karakteristik BLE membatasi tulis ke ~20 byte per paket. */
const POTONGAN_BLE = 20;

export type JenisJalur = 'bluetooth' | 'usb' | 'lan' | 'browser';

export interface Jalur {
  jenis: JenisJalur;
  nama: string;
  kirim: (data: Uint8Array) => Promise<void>;
}

export interface Dukungan {
  bluetooth: boolean;
  usb: boolean;
  /** LAN selalu "mungkin" dari sisi peramban; yang menentukan jaringannya. */
  lan: boolean;
  browser: boolean;
  /** Alasan sebuah jalur tidak tersedia, untuk ditampilkan ke pengguna. */
  catatan: string[];
}

/**
 * Apa yang benar-benar bisa dilakukan peramban ini.
 *
 * Dipakai layar Pengaturan untuk menampilkan kemampuan yang SESUNGGUHNYA, bukan
 * daftar merek printer. Pengguna Safari yang membaca "Kompatibel: Bluetooth"
 * lalu gagal menyambung akan menyimpulkan aplikasinya rusak — padahal
 * peramban itu memang tidak punya API-nya.
 */
export function dukungan(): Dukungan {
  const n: any = typeof navigator !== 'undefined' ? navigator : {};
  const aman = typeof window !== 'undefined' ? window.isSecureContext !== false : true;
  const catatan: string[] = [];

  const bluetooth = !!n.bluetooth && aman;
  const usb = !!n.usb && aman;

  if (!n.bluetooth) catatan.push('Peramban ini tidak memiliki Web Bluetooth (tersedia di Chrome/Edge Android & desktop).');
  if (!n.usb) catatan.push('Peramban ini tidak memiliki WebUSB (tersedia di Chrome/Edge desktop).');
  if (!aman) catatan.push('Halaman harus dibuka lewat HTTPS agar Bluetooth/USB bisa dipakai.');

  return { bluetooth, usb, lan: true, browser: true, catatan };
}

/**
 * Printer Bluetooth (BLE).
 *
 * Wajib dipanggil dari dalam gerakan pengguna (klik tombol) — peramban menolak
 * `requestDevice` di luar itu, dan penolakannya terlihat seperti kegagalan
 * perangkat kalau tidak dijelaskan.
 */
export async function sambungBluetooth(): Promise<Jalur> {
  const n: any = navigator;
  if (!n?.bluetooth) throw new Error('Web Bluetooth tidak tersedia di peramban ini.');

  const perangkat = await n.bluetooth.requestDevice({
    filters: [{ services: [BT_SERVICE] }],
    optionalServices: [BT_SERVICE],
  });
  const server = await perangkat.gatt.connect();
  const service = await server.getPrimaryService(BT_SERVICE);
  const ch = await service.getCharacteristic(BT_CHAR);

  return {
    jenis: 'bluetooth',
    nama: perangkat.name || 'Printer Bluetooth',
    async kirim(data) {
      /*
       * Dipotong-potong karena karakteristik BLE membatasi satu tulis ke MTU
       * (umumnya 20 byte). Mengirim struk 800 byte sekaligus tidak menghasilkan
       * kesalahan — printer hanya mencetak potongan pertama lalu diam, yang
       * jauh lebih sulit didiagnosis daripada kegagalan yang jelas.
       */
      for (let i = 0; i < data.length; i += POTONGAN_BLE) {
        await ch.writeValueWithoutResponse(data.slice(i, i + POTONGAN_BLE));
      }
    },
  };
}

/** Printer USB (WebUSB). Kelas printer USB adalah 0x07. */
export async function sambungUsb(): Promise<Jalur> {
  const n: any = navigator;
  if (!n?.usb) throw new Error('WebUSB tidak tersedia di peramban ini.');

  const perangkat = await n.usb.requestDevice({ filters: [{ classCode: 0x07 }] });
  await perangkat.open();
  if (perangkat.configuration === null) await perangkat.selectConfiguration(1);
  await perangkat.claimInterface(0);

  const endpoint = perangkat.configuration.interfaces[0].alternate.endpoints
    .find((e: any) => e.direction === 'out');
  if (!endpoint) throw new Error('Printer USB tidak punya endpoint keluar.');

  return {
    jenis: 'usb',
    nama: perangkat.productName || 'Printer USB',
    async kirim(data) { await perangkat.transferOut(endpoint.endpointNumber, data); },
  };
}

/**
 * Printer jaringan (LAN), lewat jembatan HTTP.
 *
 * Peramban TIDAK BISA membuka soket TCP mentah ke port 9100, jadi jalur ini
 * menuntut jembatan kecil di sisi server atau di perangkat POS. Disebutkan
 * apa adanya di sini supaya tidak ada yang mengira "LAN" berarti langsung dari
 * peramban ke printer.
 */
export function jalurLan(url: string, nama = 'Printer LAN'): Jalur {
  return {
    jenis: 'lan',
    nama,
    async kirim(data) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data,
      });
      if (!res.ok) throw new Error(`jembatan printer menjawab ${res.status}`);
    },
  };
}

/**
 * Cadangan: dialog cetak peramban.
 *
 * BUKAN printer termal, dan tidak berpura-pura demikian. Ia tidak memotong
 * kertas dan tidak membuka laci kasir. Ada di sini karena selalu tersedia, dan
 * struk lewat dialog lebih baik daripada tidak ada struk sama sekali.
 *
 * `kirim` mengabaikan byte ESC/POS-nya — perintah termal tidak berarti apa-apa
 * bagi dialog cetak. Yang dicetak adalah tampilan struk yang sudah ada di
 * halaman.
 */
export function jalurBrowser(): Jalur {
  return {
    jenis: 'browser',
    nama: 'Dialog cetak peramban',
    async kirim() {
      if (typeof window === 'undefined' || typeof window.print !== 'function') {
        throw new Error('Dialog cetak tidak tersedia.');
      }
      window.print();
    },
  };
}

/**
 * Memilih jalur yang tersedia menurut pengaturan merchant.
 *
 * TIDAK PERNAH melempar ketika jalur pilihan gagal: ia turun ke dialog
 * peramban dan MELAPORKAN penurunan itu. Kasir yang printernya mati tetap bisa
 * memberi struk; yang tidak boleh terjadi adalah penurunan yang tidak
 * diberitahukan, karena merchant lalu mengira laci kasirnya bekerja.
 */
export async function pilihJalur(
  preferensi: JenisJalur,
  opsi: { lanUrl?: string } = {}
): Promise<{ jalur: Jalur; turunKe: boolean; alasan?: string }> {
  try {
    if (preferensi === 'bluetooth') return { jalur: await sambungBluetooth(), turunKe: false };
    if (preferensi === 'usb') return { jalur: await sambungUsb(), turunKe: false };
    if (preferensi === 'lan') {
      if (!opsi.lanUrl) throw new Error('Alamat jembatan printer LAN belum diisi.');
      return { jalur: jalurLan(opsi.lanUrl), turunKe: false };
    }
    return { jalur: jalurBrowser(), turunKe: false };
  } catch (err) {
    return {
      jalur: jalurBrowser(),
      turunKe: true,
      alasan: (err as Error)?.message || 'jalur pilihan tidak bisa dipakai',
    };
  }
}
