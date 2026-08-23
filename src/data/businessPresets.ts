import { Category, Product, StoreMode, Table } from '../types';

export type BusinessSector = 'FNB' | 'LAUNDRY' | 'RETAIL' | 'CARWASH' | 'BARBERSHOP';

export interface BusinessLayoutTerm {
  tabLabel: string;
  title: string;
  subtitle: string;
  itemNoun: string;
  addBtnText: string;
  capacityLabel: string;
  capacityUnit: string;
  zones: string[];
  emptyText: string;
  occupiedText: string;
  statusBadges: {
    available: string;
    occupied: string;
    reserved: string;
    billing: string;
  };
}

/*
 * KATALOG BAWAAN — DIKOSONGKAN.
 *
 * `categories`, `products`, dan `tables` di setiap preset dulu berisi katalog
 * contoh lengkap: "Es Kopi Susu Gula Aren", "Cuci Kering Setrika 1kg", daftar
 * meja "Meja 01".."Meja 12", beserta harga dan HPP-nya. Kira-kira 700 baris
 * data yang bukan milik siapa pun.
 *
 * Sudah TIDAK LAGI disemai ke state sejak katalog awal dikosongkan — tapi
 * membiarkannya di sini berarti setiap orang yang membacanya masih bisa
 * menyimpulkan bahwa aplikasi ini punya isi bawaan, dan satu baris kode saja
 * cukup untuk menyalakannya kembali tanpa sengaja. Preset tetap dipakai untuk
 * yang memang milik aplikasi: istilah tata letak per sektor, nama, ikon, dan
 * teks pemasaran.
 *
 * Toko baru mengisi katalognya sendiri, lewat entri manual, impor CSV, atau
 * foto menu.
 */
export interface BusinessPreset {
  id: BusinessSector;
  name: string;
  categoryTag: string;
  tagline: string;
  defaultStoreName: string;
  storeMode: StoreMode;
  badge: string;
  accentColor: string;
  bgGradient: string;
  iconName: string;
  heroHeadline: string;
  description: string;
  layoutTerm: BusinessLayoutTerm;
  features: {
    title: string;
    desc: string;
  }[];
  categories: Category[];
  products: Product[];
  tables: Table[];
}

export const BUSINESS_PRESETS: Record<BusinessSector, BusinessPreset> = {
  FNB: {
    id: 'FNB',
    name: 'Kafe, Resto & F&B',
    categoryTag: 'Kuliner & Minuman',
    tagline: 'Sistem Kasir Restoran, Kedai Kopi & Fast Food Modern',
    defaultStoreName: 'New Hope Cafe & Resto',
    storeMode: 'FNB',
    badge: 'Paling Populer',
    accentColor: 'amber',
    bgGradient: 'from-amber-500 to-orange-600',
    iconName: 'Coffee',
    heroHeadline: 'Kelola Pesanan Meja, Dapur & Transaksi Fast-Checkout Kasir F&B',
    description:
      'Solusi lengkap untuk restoran dan kafe. Fitur denah meja interaktif, kirim pesanan ke dapur, varian topping/modifier, cetak struk dapur & kasir, serta integrasi pesanan online.',
    layoutTerm: {
      tabLabel: 'Denah Meja Resto',
      title: 'Denah Meja & Area Resto (Dine In)',
      subtitle: 'Pantau ketersediaan meja, status pelanggan aktif, serta tagihan order meja real-time.',
      itemNoun: 'Meja Resto',
      addBtnText: 'Tambah Meja Baru',
      capacityLabel: 'Kapasitas Kursi',
      capacityUnit: 'Orang',
      zones: ['Main Hall', 'VIP Room', 'Outdoor Terrace', 'Bar Area'],
      emptyText: 'Meja Kosong (Siap Ditempati)',
      occupiedText: 'Sedang Terisi (Makan)',
      statusBadges: {
        available: 'Kosong (Tersedia)',
        occupied: 'Terisi (Order Aktif)',
        reserved: 'Reservasi',
        billing: 'Minta Struk',
      },
    },
    features: [
      { title: 'Denah Meja Interaktif', desc: 'Pantau status ketersediaan meja, gabung meja, dan reservasi Dine-In secara visual.' },
      { title: 'Modifier & Topping', desc: 'Atur varian rasa, tingkat kemanisan (less sugar), dan extra shot espresso dengan harga fleksibel.' },
      { title: 'Order Hold & Recall', desc: 'Simpan pesanan sementara untuk pelanggan yang masih memilih menu tanpa menghambat antrian.' },
      { title: 'Laporan HPP & Bahan Baku', desc: 'Analisis profitabilitas tiap porsi makanan dan minuman secara akurat.' },
    ],
    categories: [],
    products: [],
    tables: [],
  },

  LAUNDRY: {
    id: 'LAUNDRY',
    name: 'Laundry Kiloan & Satuan',
    categoryTag: 'Jasa & Perawatan Pakaian',
    tagline: 'Sistem Kasir Laundry Kilat, Timbang Kg, & Lacak Status Pengerjaan',
    defaultStoreName: 'New Hope Clean & Fresh Laundry',
    storeMode: 'SERVICE',
    badge: 'Fitur Timbang Kg',
    accentColor: 'blue',
    bgGradient: 'from-blue-600 to-cyan-600',
    iconName: 'WashingMachine',
    heroHeadline: 'Cetak Nota Laundry, Lacak Status Cuci/Setrika, & Timbang Kiloan',
    description:
      'Aplikasi khusus usaha laundry kiloan, satuan, dry clean, hingga perawatan sepatu & karpet. Catat desimal timbangan berat kg, status antrian pengerjaan, dan kirim notifikasi nota ke WhatsApp pelanggan.',
    layoutTerm: {
      tabLabel: 'Denah Mesin & Rak Laundry',
      title: 'Manajemen Mesin Cuci, Dryer & Rak Storage Laundry',
      subtitle: 'Kelola mesin washer/dryer aktif, lokasi penyimpanan cucian, nomor rak siap ambil, serta status pengerjaan laundry.',
      itemNoun: 'Mesin / Rak Laundry',
      addBtnText: 'Tambah Mesin / Rak Baru',
      capacityLabel: 'Kapasitas Mesin / Rak',
      capacityUnit: 'Kg / Unit',
      zones: ['Mesin Cuci (Washer)', 'Mesin Pengering (Dryer)', 'Rak Pakaian Bersih', 'Loker Siap Ambil', 'Rak Bedcover & Karpet'],
      emptyText: 'Mesin / Rak Kosong (Standby)',
      occupiedText: 'Sedang Beroperasi / Terisi Cucian',
      statusBadges: {
        available: 'Standby (Tersedia)',
        occupied: 'Sedang Beroperasi / Terisi',
        reserved: 'Booking Sesi',
        billing: 'Selesai (Siap Ambil & Bayar)',
      },
    },
    features: [
      { title: 'Timbangan Desimal Kg', desc: 'Input jumlah timbangan hingga 2 desimal (misal 3.85 kg) langsung dihitung akurat.' },
      { title: 'Lacak Status Pengerjaan', desc: 'Pantau status: Antrian -> Proses Cuci -> Pengeringan -> Setrika -> Siap Ambil.' },
      { title: 'Layanan Express & Kilat', desc: 'Beri tarif khusus layanan selesai 3 jam, 6 jam, atau reguler 2 hari.' },
      { title: 'Rak Penyimpanan Nota', desc: 'Catat nomor rak penyimpanan baju agar kasir mudah menemukan pakaian yang akan diambil.' },
    ],
    categories: [],
    products: [],
    tables: [],
  },

  RETAIL: {
    id: 'RETAIL',
    name: 'Ritel, Toko & Minimarket',
    categoryTag: 'Perdagangan & Retail',
    tagline: 'Sistem Kasir Minimarket, Barcode Scanner, SKU & Penjualan Grosir',
    defaultStoreName: 'New Hope Mart & Retail Store',
    storeMode: 'RETAIL',
    badge: 'Scan Barcode',
    accentColor: 'emerald',
    bgGradient: 'from-emerald-600 to-teal-700',
    iconName: 'ShoppingBag',
    heroHeadline: 'Scan Barcode Cepat, Kelola Ribuan SKU & Stok Grosir/Eceran',
    description:
      'Dirancang khusus untuk minimarket, toko kelontong, fashion, dan toko elektronik. Pemindaian barcode kamera/USB berkecepatan tinggi, cetak price tag, dan pencatatan varian ukuran/warna.',
    layoutTerm: {
      tabLabel: 'Denah Display & Lorong',
      title: 'Layout Lorong & Display Rak Minimarket',
      subtitle: 'Atur zonasi lorong display produk, rak promo khusus, dan etalase kasir untuk pemantauan ketersediaan barang.',
      itemNoun: 'Lorong / Display Rak',
      addBtnText: 'Tambah Display / Lorong Baru',
      capacityLabel: 'Kapasitas SKU Display',
      capacityUnit: 'SKU',
      zones: ['Lorong Sembako', 'Lorong Snack & Drink', 'Display Depan Kasir', 'Rak Clearance / Promo'],
      emptyText: 'Display Normal (Stok Tersedia)',
      occupiedText: 'Restock Diperlukan (Penjualan Tinggi)',
      statusBadges: {
        available: 'Stok Normal',
        occupied: 'Sedang Di-Restock',
        reserved: 'Display Khusus Promo',
        billing: 'Peringatan Stok Menipis',
      },
    },
    features: [
      { title: 'Barcode Scanning Fast', desc: 'Mendukung pemindai USB/Bluetooth dan scan via kamera perangkat secara instan.' },
      { title: 'Harga Bertingkat / Grosir', desc: 'Atur diskon khusus pembelian kuantitas banyak (grosir).' },
      { title: 'Peringatan Kadaluarsa & Stok', desc: 'Notifikasi otomatis jika stok produk menipis atau mendekati expired.' },
      { title: 'Multi SKU & Varian Warna/Ukuran', desc: 'Satu produk dengan banyak pilihan varian warna, size, dan kode barcode terpisah.' },
    ],
    categories: [],
    products: [],
    tables: [],
  },

  CARWASH: {
    id: 'CARWASH',
    name: 'Cuci Mobil & Motor (Carwash)',
    categoryTag: 'Otomotif & Service',
    tagline: 'Sistem Antrian Plat Nomor, Paket Cuci Hidrolik & Detailing',
    defaultStoreName: 'New Hope Auto Wash & Detailing',
    storeMode: 'SERVICE',
    badge: 'Sistem Plat Nomor',
    accentColor: 'indigo',
    bgGradient: 'from-indigo-600 to-blue-700',
    iconName: 'Car',
    heroHeadline: 'Catat Plat Nomor Kendaraan, Kelola Antrian Wash & Komisi Washer',
    description:
      'Solusi terpadu untuk usaha tempat cuci mobil, motor, dan salon detailing otomotif. Input nomor plat kendaraan di struk, lacak antrian pencucian, serta hitung komisi tim pencuci (operator).',
    layoutTerm: {
      tabLabel: 'Denah Bay & Pit Carwash',
      title: 'Manajemen Bay, Pit Hidrolik & Station Auto Wash',
      subtitle: 'Pantau ketersediaan bay hidrolik cuci, antrian busa salju, pit detailing nano ceramic, dan area cuci motor.',
      itemNoun: 'Bay / Pit Carwash',
      addBtnText: 'Tambah Bay / Pit Baru',
      capacityLabel: 'Kapasitas Kendaraan',
      capacityUnit: 'Unit',
      zones: ['Area Hidrolik Mobil', 'Area Busa & Cuci', 'Pit Detailing & Coating', 'Area Motor'],
      emptyText: 'Bay Kosong (Standby Siap Cuci)',
      occupiedText: 'Sedang Proses Pencucian Kendaraan',
      statusBadges: {
        available: 'Standby (Kosong)',
        occupied: 'Sedang Dicuci / Detailing',
        reserved: 'Booking Sesi',
        billing: 'Selesai Wash (Siap Bayar)',
      },
    },
    features: [
      { title: 'Catat Plat Nomor & Tipe', desc: 'Sertakan nomor plat (misal B 1234 ABC) dan warna mobil pada nota fisik kasir.' },
      { title: 'Manajemen Antrian Pencucian', desc: 'Pantau kendaraan yang sedang dicuci, pengeringan, hingga siap diserahkan.' },
      { title: 'Hitung Komisi Tim Operator', desc: 'Sistem otomatis mencatat bagi hasil / komisi pegawai pencuci per unit kendaraan.' },
      { title: 'Paket Wax & Hydro Detailing', desc: 'Jual paket combo cuci body + vakum interior + nano coating.' },
    ],
    categories: [],
    products: [],
    tables: [],
  },

  BARBERSHOP: {
    id: 'BARBERSHOP',
    name: 'Barbershop & Salon Kecantikan',
    categoryTag: 'Kecantikan & Perawatan Diri',
    tagline: 'Sistem Kasir Barbershop, Booking Stylist & Komisi Kapster',
    defaultStoreName: 'New Hope Gentlemen Barbershop',
    storeMode: 'SERVICE',
    badge: 'Pilih Kapster',
    accentColor: 'purple',
    bgGradient: 'from-purple-600 to-pink-600',
    iconName: 'Scissors',
    heroHeadline: 'Atur Pilihan Kapster / Stylist, Layanan Paket & Penjualan Pomade',
    description:
      'Solusi kasir modern untuk usaha pangkas rambut pria, salon wanita, dan tempat perawatan spa. Bebas tentukan stylist/kapster bertugas, paket treatment komplit, dan penjualan produk perawatan rambut.',
    layoutTerm: {
      tabLabel: 'Denah Kursi Barber',
      title: 'Manajemen Kursi Barber, Wash Basin & Room Treatment',
      subtitle: 'Kelola ketersediaan kapster/stylist di kursi cukur, station keramas, dan ruangan treatment kecantikan.',
      itemNoun: 'Kursi / Station Barber',
      addBtnText: 'Tambah Kursi / Station Baru',
      capacityLabel: 'Kapster / Stylist Duty',
      capacityUnit: 'Kapster',
      zones: ['Main Barber Chair', 'Wash Basin Station', 'VIP Room Treatment', 'Pedicure & Spa Zone'],
      emptyText: 'Kursi Kosong (Standby Siap Cukur)',
      occupiedText: 'Sedang Proses Haircut / Treatment',
      statusBadges: {
        available: 'Standby (Kosong)',
        occupied: 'Sedang Cukur / Haircut',
        reserved: 'Booking Stylist',
        billing: 'Selesai Service (Siap Bayar)',
      },
    },
    features: [
      { title: 'Penugasan Kapster / Stylist', desc: 'Pilih nama stylist yang mengerjakan jasa untuk perhitungan komisi akurat.' },
      { title: 'Paket Treatment Combo', desc: 'Gabungkan potong rambut + cuci + pijat kepala + vitamin rambut dalam 1 paket.' },
      { title: 'Penjualan Produk Retail Haircare', desc: 'Jual pomade, hair clay, serum rambut, dan shampo langsung dari kasir.' },
      { title: 'Database Pelanggan & Model Haircut', desc: 'Simpan riwayat model rambut langganan pada profil pelanggan.' },
    ],
    categories: [],
    products: [],
    tables: [],
  },
};
