import React, { useState, useEffect } from 'react';
import { usePOS } from '../../context/POSContext';
import { formatRupiah } from '../../utils/formatters';
import { BUSINESS_PRESETS, BusinessSector } from '../../data/businessPresets';
import confetti from 'canvas-confetti';
import {
  Coffee,
  Shirt,
  ShoppingBag,
  Car,
  Scissors,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Zap,
  TrendingUp,
  Store,
  Settings,
  ShoppingCart,
  BarChart3,
  Bot,
  Grid2X2,
  Users,
  Check,
  Building2,
  Phone,
  UserCheck,
  ShieldCheck,
  Scale,
  FileText,
  X,
  Play,
  RotateCcw,
  BadgePercent,
  CheckCircle,
  QrCode,
  CreditCard,
  Printer,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  HelpCircle,
  Clock,
  DollarSign,
  Package,
  Award,
  Star,
  Flame,
  ArrowUpRight,
  Shield,
  Smartphone,
  BookOpen,
  Monitor,
  Tablet,
  Sliders,
  Calculator,
  Receipt,
  Banknote,
  Trash2,
  Plus,
  Minus,
  Sparkle,
  Radio,
  Layers,
  Laptop,
} from 'lucide-react';

interface HomePageProps {
  onOpenLogin?: () => void;
  onOpenRegister?: () => void;
  isStandaloneLanding?: boolean;
}

interface KatalogPaket {
  id: string;
  name: string;
  tierLevel: number;
  priceIdr: number;
  priceYearlyIdr?: number;
  extraOutletPriceIdr?: number;
  features: string[];
  productLimit: number;
  maxOutlets: number;
  aiQuotaMonthly: number;
  trialDays?: number;
}

/** "Tanpa batas" untuk -1, angka apa adanya selain itu. */
const labelBatas = (n: number) => (n === -1 ? 'Tanpa batas' : String(n));

/** Rp 99rb / Rp 299rb — bentuk yang dipakai kartu harga. */
const ringkasRupiah = (n: number) => {
  if (n === 0) return 'Rp 0';
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}jt`;
  if (n >= 1_000) return `Rp ${Math.round(n / 1_000)}rb`;
  return `Rp ${n}`;
};

interface SimulatorCartItem {
  id: string;
  name: string;
  price: number;
  qty: number;
  sector: BusinessSector;
}

export const HomePage: React.FC<HomePageProps> = ({
  onOpenLogin,
  onOpenRegister,
  isStandaloneLanding = false,
}) => {
  const {
    setActiveTab,
    products,
    categories,
    tables,
    customers,
    orders,
    shift,
    settings,
    currentUser,
    hasPermission,
    activateBusinessSector,
  } = usePOS();

  const [selectedPresetSector, setSelectedPresetSector] = useState<BusinessSector>(
    settings.businessSector || 'FNB'
  );

  // Billing Toggle State (Monthly vs Annual with 20% discount)
  const [isYearlyBilling, setIsYearlyBilling] = useState<boolean>(false);

  // Interactive AI Simulator State
  const [activeAIQueryIdx, setActiveAIQueryIdx] = useState<number>(0);

  // FAQ Accordion State
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);

  // Active Feature Tab
  const [activeFeatureTab, setActiveFeatureTab] = useState<number>(0);

  // Registration Toast State
  const [registerSuccessMsg, setRegisterSuccessMsg] = useState<string | null>(null);

  /*
   * KARTU HARGA DIBACA DARI KATALOG, tidak ditulis ulang di sini.
   *
   * Sebelumnya keempat kartu memuat angkanya sendiri — "45 Hari", "Limit 100
   * Produk", "Up to 4 Outlet" — dan begitu katalog di panel admin berubah,
   * halaman ini tetap menjanjikan angka lama kepada calon pelanggan. Janji yang
   * tidak ditepati bukan sekadar tampilan yang usang; itu yang dibaca orang
   * sebelum memutuskan berlangganan.
   */
  const [paket, setPaket] = useState<KatalogPaket[]>([]);

  useEffect(() => {
    let aktif = true;
    fetch('/api/v1/subscription/plans')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (aktif && d?.ok && Array.isArray(d.plans)) setPaket(d.plans);
      })
      .catch(() => {
        // Diam. Bagian harga akan kosong, dan halaman kosong lebih jujur
        // daripada harga karangan yang bisa dipakai orang untuk mengambil
        // keputusan.
      });
    return () => { aktif = false; };
  }, []);

  /*
   * LAMA MASA PERCOBAAN DIAMBIL DARI KATALOG.
   *
   * Empat tempat di halaman ini menjanjikan "Coba Gratis 45 Hari" — ajakan
   * utama di hero, di tengah halaman, di bagian penutup, dan di FAQ. Paketnya
   * 14 hari. Angka yang dijanjikan sebelum orang mendaftar adalah angka yang
   * paling mahal kalau salah: yang mendaftar karena dijanjikan 45 hari akan
   * menemukan aplikasinya terkunci di hari ke-15.
   *
   * Selama katalog belum termuat, dipakai bentuk tanpa angka sama sekali —
   * "Coba Gratis" — bukan tebakan yang bisa keliru.
   */
  const hariTrial = paket.find((p) => (p.trialDays ?? 0) > 0)?.trialDays ?? 0;
  const labelTrial = hariTrial > 0 ? `Coba Gratis ${hariTrial} Hari` : 'Coba Gratis';

  // Metrics calculation
  const todayStr = new Date().toISOString().split('T')[0];
  const todayOrders = orders.filter(
    (o) => o.date.startsWith(todayStr) && o.status === 'COMPLETED'
  );
  const todaySales = todayOrders.reduce((sum, o) => sum + o.total, 0);
  const todayItemsSold = todayOrders.reduce(
    (sum, o) => sum + o.items.reduce((iSum, i) => iSum + i.quantity, 0),
    0
  );

  // 🧮 Interactive ROI & Growth Calculator State (Spot On & Majoo style)
  const [monthlyRevenue, setMonthlyRevenue] = useState<number>(35000000); // 35 Juta default
  const [dailyTransactions, setDailyTransactions] = useState<number>(65);
  const [staffCount, setStaffCount] = useState<number>(3);

  // 🎮 Hero Live POS Terminal Interactive Simulator State (Spot On & Moka style)
  const [simSector, setSimSector] = useState<BusinessSector>('FNB');
  const [simCart, setSimCart] = useState<SimulatorCartItem[]>([
    { id: 'sim-1', name: 'Es Kopi Gula Aren', price: 18000, qty: 2, sector: 'FNB' },
    { id: 'sim-2', name: 'Croissant Butter', price: 22000, qty: 1, sector: 'FNB' },
  ]);
  const [showSimPaymentModal, setShowSimPaymentModal] = useState<boolean>(false);
  const [simPaymentDone, setSimPaymentDone] = useState<boolean>(false);

  // 🔔 Live Social Proof Floating Toast Ticker (Spot On style)
  const [currentToastIdx, setCurrentToastIdx] = useState<number>(0);
  const [showLiveToast, setShowLiveToast] = useState<boolean>(true);

  const liveSocialProofs = [
    {
      title: 'Kopi Senayan Jakarta',
      action: 'berhasil memproses pembayaran QRIS Dinamis Rp 48.000',
      time: 'Baru saja (2 detik lalu)',
      tag: 'QRIS Otomatis',
      color: 'text-amber-400',
    },
    {
      title: 'Dago Express Laundry Bandung',
      action: 'mengirim nota digital otomatis via WhatsApp ke pelanggan',
      time: '18 detik lalu',
      tag: 'Nota WhatsApp',
      color: 'text-blue-400',
    },
    {
      title: 'Toko Berkah Sentosa Surabaya',
      action: 'menerima rekomendasi restock bahan baku dari AI Copilot',
      time: '45 detik lalu',
      tag: 'Smart Restock',
      color: 'text-emerald-400',
    },
    {
      title: 'The Gentleman Barbershop Medan',
      action: 'mencatat komisi layanan kapster otomatis dalam 1 klik',
      time: '1 menit lalu',
      tag: 'Komisi Otomatis',
      color: 'text-purple-400',
    },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentToastIdx((prev) => (prev + 1) % liveSocialProofs.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [liveSocialProofs.length]);

  // Simulator Catalog Items
  const simulatorCatalog: Record<BusinessSector, Array<{ id: string; name: string; price: number; icon: string }>> = {
    FNB: [
      { id: 'fnb-1', name: 'Es Kopi Gula Aren', price: 18000, icon: '☕' },
      { id: 'fnb-2', name: 'Croissant Butter', price: 22000, icon: '🥐' },
      { id: 'fnb-3', name: 'Matcha Latte Oat', price: 25000, icon: '🍵' },
      { id: 'fnb-4', name: 'Nasi Goreng Spesial', price: 32000, icon: '🍳' },
    ],
    LAUNDRY: [
      { id: 'lnd-1', name: 'Cuci Kering Lipat 5Kg', price: 35000, icon: '🧺' },
      { id: 'lnd-2', name: 'Cuci Setrika Express', price: 50000, icon: '👔' },
      { id: 'lnd-3', name: 'Bed Cover King Size', price: 40000, icon: '🛏️' },
      { id: 'lnd-4', name: 'Cuci Sepatu Premium', price: 30000, icon: '👟' },
    ],
    RETAIL: [
      { id: 'rtl-1', name: 'Beras Premium 5 Kg', price: 74000, icon: '🌾' },
      { id: 'rtl-2', name: 'Minyak Goreng 2 Liter', price: 36000, icon: '🌻' },
      { id: 'rtl-3', name: 'Gula Pasir 1 Kg', price: 17500, icon: '🧂' },
      { id: 'rtl-4', name: 'Susu UHT Full Cream', price: 19500, icon: '🥛' },
    ],
    BARBERSHOP: [
      { id: 'brb-1', name: 'Gentleman Haircut + Wash', price: 50000, icon: '✂️' },
      { id: 'brb-2', name: 'Beard Trim & Shave', price: 30000, icon: '🪒' },
      { id: 'brb-3', name: 'Hair Color Treatment', price: 90000, icon: '🎨' },
      { id: 'brb-4', name: 'Creambath Tradisional', price: 60000, icon: '💆' },
    ],
    CARWASH: [
      { id: 'cw-1', name: 'Cuci Hidrolik Salju + Vac', price: 50000, icon: '🚗' },
      { id: 'cw-2', name: 'Poles Jamur Kaca Depan', price: 75000, icon: '✨' },
      { id: 'cw-3', name: 'Fogging Anti-Bakteri', price: 45000, icon: '💨' },
      { id: 'cw-4', name: 'Cuci Motor Matic Salju', price: 20000, icon: '🛵' },
    ],
  };

  const handleAddSimItem = (item: { id: string; name: string; price: number }) => {
    setSimCart((prev) => {
      const existing = prev.find((p) => p.id === item.id);
      if (existing) {
        return prev.map((p) => (p.id === item.id ? { ...p, qty: p.qty + 1 } : p));
      }
      return [...prev, { ...item, qty: 1, sector: simSector }];
    });
  };

  const handleUpdateSimQty = (id: string, delta: number) => {
    setSimCart((prev) =>
      prev
        .map((p) => {
          if (p.id === id) {
            const newQty = p.qty + delta;
            return newQty > 0 ? { ...p, qty: newQty } : null;
          }
          return p;
        })
        .filter(Boolean) as SimulatorCartItem[]
    );
  };

  const simSubtotal = simCart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const simTax = Math.round(simSubtotal * 0.1);
  const simTotal = simSubtotal + simTax;

  const handleTriggerSimPayment = () => {
    setShowSimPaymentModal(true);
    setSimPaymentDone(false);
  };

  const handleExecuteSimSuccess = () => {
    setSimPaymentDone(true);
    confetti({
      particleCount: 75,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#f59e0b', '#10b981', '#6366f1'],
    });
    setTimeout(() => {
      setShowSimPaymentModal(false);
      setSimCart([]);
      setSimPaymentDone(false);
    }, 3500);
  };

  // ROI & Growth Calculations (Spot On style)
  const calculatedSavingsMonthly = Math.round(monthlyRevenue * 0.065);
  const calculatedTimeSavedHours = Math.round(dailyTransactions * 0.05 * 30 + staffCount * 4);
  const calculatedYearlyExtraProfit = calculatedSavingsMonthly * 12;
  const subscriptionCostYearly = 948000; // Tier Plus (Annual)
  const roiMultiplier = Math.max(1, Math.round(calculatedYearlyExtraProfit / subscriptionCostYearly));

  const selectedPreviewPreset = BUSINESS_PRESETS[selectedPresetSector];

  const handleApplySector = (sector: BusinessSector, customName?: string) => {
    activateBusinessSector(sector, customName);
    setRegisterSuccessMsg(
      `Mode bisnis "${BUSINESS_PRESETS[sector].name}" berhasil diaktifkan! Katalog & produk contoh siap digunakan.`
    );
    setTimeout(() => setRegisterSuccessMsg(null), 6000);
  };

  const sectorIcons: Record<BusinessSector, any> = {
    FNB: Coffee,
    LAUNDRY: Shirt,
    RETAIL: ShoppingBag,
    CARWASH: Car,
    BARBERSHOP: Scissors,
  };

  /*
   * "Coba kasir" MENGARAH KE PENDAFTARAN, bukan membuka aplikasi penuh.
   *
   * Versi tampilan ini memanggil onStartDemo, dan bila tidak ada, jatuh ke
   * setActiveTab('pos') — membuka aplikasi kasir sungguhan untuk pengunjung
   * tanpa akun. Tanpa akun berarti tanpa merchant, tanpa langganan, dan karena
   * itu tanpa satu pun batas paket yang bisa ditegakkan: jalan memutar
   * mengelilingi seluruh paywall, dari tombol di halaman depan.
   *
   * Peragaannya tetap ada dan tetap di halaman ini — simulator POS di hero
   * berjalan sepenuhnya di dalam komponen, tidak menyentuh data siapa pun.
   * Yang tidak dikembalikan hanyalah pintu masuk ke aplikasi penuh.
   */
  const handleOpenPOS = () => {
    onOpenRegister?.();
  };

  // 4 Core Solution Pillars (Moka, Majoo & Spot On style)
  const solutionPillars = [
    {
      id: 'pillar-checkout',
      icon: QrCode,
      badge: 'Kasir Kilat & QRIS Otomatis',
      title: 'Transaksi Cepat & Pembayaran Non-Tunai Otomatis',
      desc: 'Layani pelanggan dalam hitungan detik. Generate QRIS Dinamis dengan nominal pas hingga rupiah terkecil, terima konfirmasi otomatis tanpa cek mutasi manual, dan kirim struk digital langsung ke WhatsApp pelanggan.',
      benefit: 'Pelayanan 2x lebih cepat, bebas salah ketik nominal, dan antrean kasir selalu lancar.',
      metric: '< 3 Detik',
      metricLabel: 'Waktu Proses Checkout',
      color: 'from-amber-500 to-amber-700',
      accentColor: 'text-amber-400',
      bgColor: 'bg-amber-500/10 border-amber-500/30',
    },
    {
      id: 'pillar-inventory',
      icon: Package,
      badge: 'Manajemen Stok & Resep',
      title: 'Kontrol Persediaan & Perhitungan HPP Otomatis',
      desc: 'Pantau stok bahan baku mentah, bahan setengah jadi, hingga menu siap saji dengan sistem Bill of Materials (BOM). Setiap penjualan otomatis memotong stok sesuai resep gramatur dengan notifikasi cerdas saat bahan menipis.',
      benefit: 'HPP terhitung presisi, pantau margin laba per menu, dan restock selalu tepat waktu.',
      metric: '100% Akurat',
      metricLabel: 'Potong Stok Gramatur',
      color: 'from-emerald-500 to-teal-700',
      accentColor: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10 border-emerald-500/30',
    },
    {
      id: 'pillar-analytics',
      icon: TrendingUp,
      badge: 'Laporan Finansial Real-Time',
      title: 'Pantau Omset, Profit & Karyawan dari Mana Saja',
      desc: 'Dapatkan visualisasi lengkap performa bisnis Anda secara langsung dari smartphone. Pantau tren omset harian, produk terlaris, laba kotor, hingga perhitungan komisi staf dan laporan absensi tanpa perlu rumus manual.',
      benefit: 'Tutup buku harian selesai dalam 1 menit, bisnis berjalan autopilot dengan kendali penuh.',
      metric: 'Real-Time',
      metricLabel: 'Dashboard & Laporan Usaha',
      color: 'from-blue-500 to-indigo-700',
      accentColor: 'text-blue-400',
      bgColor: 'bg-blue-500/10 border-blue-500/30',
    },
    {
      id: 'pillar-offline',
      icon: Zap,
      badge: 'Keandalan Offline-First',
      title: 'Jualan Tetap Lancar Tanpa Khawatir Internet Putus',
      desc: 'Dirancang dengan arsitektur Offline-First yang tangguh. Kasir Anda tetap dapat memproses pesanan, membuka laci kasir (cash drawer), dan mencetak struk thermal saat sinyal WiFi atau internet terputus.',
      benefit: 'Data otomatis tersinkronisasi saat online kembali tanpa risiko transaksi ganda.',
      metric: '99.99%',
      metricLabel: 'Jaminan Kelancaran Kasir',
      color: 'from-purple-500 to-rose-700',
      accentColor: 'text-purple-400',
      bgColor: 'bg-purple-500/10 border-purple-500/30',
    },
  ];

  // AI Simulator Mock Prompts & Responses
  const aiSimulations = [
    {
      query: '📦 Stok apa yang perlu di-restock minggu ini?',
      tag: 'Prediksi Stok & HPP',
      badge: 'Rp 0 · < 5ms',
      answer:
        'Berdasarkan rata-rata penjualan 7 hari terakhir: 1) Biji Kopi Gayo tersisa 1.8 Kg (cukup ~85 cup lagi, disarankan pesan sebelum Kamis), 2) Susu Fresh Milk tersisa 3 Liter (estimasi habis besok pukul 14.30). Klik tombol [Pesan Ulang] untuk menghubungi supplier.',
    },
    {
      query: '💰 Bagaimana performa omset & laba kotor hari ini?',
      tag: 'Laporan Penjualan Real-time',
      badge: 'Rp 0 · < 5ms',
      answer:
        'Total omset hari ini tercatat Rp 3.840.000 dari 42 transaksi. Estimasi HPP bahan baku terpakai: Rp 1.450.000. Laba Kotor Harian: Rp 2.390.000 (Margin 62.2%). Penjualan naik 14% dibandingkan hari yang sama minggu lalu.',
    },
    {
      query: '🏆 Apa menu paling laris & rekomendasi bundling promosi?',
      tag: 'Analitik Menu & Produk',
      badge: 'Rp 0 · < 5ms',
      answer:
        'Menu Terlaris: "Es Kopi Susu Gula Aren" (58 cup terjual, kontribusi omset 38%). Rekomendasi AI: Buat paket kombo bundling hemat "Es Kopi Susu + Croissant Butter" untuk mendongkrak rata-rata nilai transaksi (basket size) sebesar 22%.',
    },
    {
      query: '⭐ Siapa staf dengan kontribusi transaksi terbaik hari ini?',
      tag: 'Performa Staf & Komisi',
      badge: 'Rp 0 · < 5ms',
      answer:
        'Budi Santoso mencatat 28 transaksi kasir dengan total penjualan Rp 2.450.000 dengan kepuasan pelanggan sempurna. Mas Alex (Stylist) menyelesaikan 8 pengerjaan potong rambut dengan estimasi komisi jasa Rp 240.000.',
    },
  ];

  // Testimonials Data (Moka & Majoo style)
  const testimonials = [
    {
      quote:
        'New Hope POS sangat praktis dan mudah digunakan oleh barista kami. Fitur resep otomatisnya membuat perhitungan HPP jadi sangat rapi, dan pembayaran QRIS Dinamis membuat antrean kasir jadi super cepat!',
      name: 'Doni Pratama',
      role: 'Owner & Founder',
      business: 'Kopi Senayan Jakarta (3 Outlet)',
      sector: 'Kafe & Restoran (F&B)',
      rating: 5,
      icon: Coffee,
      color: 'from-amber-500 to-amber-700',
    },
    {
      quote:
        'Fitur kirim nota otomatis ke WhatsApp dan pelacakan status cucian membuat pelanggan merasa tenang dan terlayani dengan profesional. Pelanggan repeat order kami meningkat drastis!',
      name: 'Ibu Hj. Siti Aminah',
      role: 'Pemilik Usaha',
      business: 'Dago Express Laundry Bandung',
      sector: 'Laundry Kiloan & Satuan',
      rating: 5,
      icon: Shirt,
      color: 'from-blue-500 to-indigo-700',
    },
    {
      quote:
        'Scan barcode ribuan produk sembako sangat cepat tanpa jeda. Tutup buku harian yang biasanya memakan waktu berjam-jam kini selesai dalam beberapa klik saja langsung dari HP.',
      name: 'Hendra Wijaya',
      role: 'Pengelola Toko',
      business: 'Toko Berkah Sentosa Surabaya',
      sector: 'Ritel & Minimarket',
      rating: 5,
      icon: ShoppingBag,
      color: 'from-emerald-500 to-teal-700',
    },
    {
      quote:
        'Sistem bagi hasil komisi kapster terhitung otomatis dan transparan. Pelanggan juga senang karena antrean booking tertata rapi. Aplikasi kasir terbaik untuk salon dan barbershop!',
      name: 'Mas Alex Stylist',
      role: 'Master Barber & Founder',
      business: 'The Gentleman Barbershop Medan',
      sector: 'Barbershop & Salon',
      rating: 5,
      icon: Scissors,
      color: 'from-purple-500 to-rose-700',
    },
  ];

  // FAQs Data
  const faqs = [
    {
      q: 'Apakah New Hope POS bisa tetap digunakan saat koneksi internet mati (Offline)?',
      a: 'Tentu saja! New Hope POS menggunakan arsitektur Offline-First yang tangguh. Kasir Anda tetap bisa memproses pesanan, membuka laci kasir, dan mencetak struk saat internet terputus. Data transaksi akan otomatis tersinkronisasi ke cloud begitu internet terhubung kembali.',
    },
    {
      q: 'Bagaimana jika saya ingin dibantu memasukkan daftar menu atau produk toko?',
      a: 'Kami menyediakan layanan Onboarding & Setup Menu GRATIS. Cukup kirimkan foto daftar menu, nota, atau file Excel katalog Anda ke tim WhatsApp kami. Tim New Hope POS akan meng-input seluruh data produk & resep Anda sampai siap jualan dalam waktu kurang dari 3 jam.',
    },
    {
      q: 'Kapan dana pembayaran dari transaksi QRIS Dinamis masuk ke rekening saya?',
      a: 'Dana pembayaran QRIS Dinamis otomatis dicairkan (Auto-Settlement) langsung ke rekening bank pilihan Anda (BCA, Mandiri, BRI, BNI, dll) setiap H+1 secara terjadwal dan transparan.',
    },
    {
      q: 'Apakah saya bisa menggunakan tablet, HP Android, atau laptop yang sudah saya miliki?',
      a: 'Bisa banget! Anda tidak wajib membeli perangkat baru. New Hope POS kompatibel dengan HP Android, Tablet, iPad, Laptop/PC Windows, hingga mesin Android POS profesional (Sunmi, iMin) serta printer termal Bluetooth.',
    },
    {
      q: `Apakah paket ${labelTrial} benar-benar tanpa biaya dan tanpa kartu kredit?`,
      a: '100% Gratis tanpa biaya tersembunyi dan tanpa perlu kartu kredit. Anda dapat langsung mencoba seluruh fitur kasir, inventori, dan analitik toko secara nyata.',
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 selection:bg-amber-500 selection:text-slate-950 space-y-12 lg:space-y-24 pb-28 relative">
      
      {/* 🌟 1. STICKY TOP NAVIGATION BAR */}
      <header className="sticky top-0 z-40 bg-slate-950/85 backdrop-blur-xl border-b border-slate-800/80 px-4 lg:px-8 py-3.5 flex items-center justify-between transition-all shadow-xl">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-gradient-to-tr from-amber-500 to-amber-400 text-slate-950 rounded-2xl font-black shadow-lg shadow-amber-500/20">
            <Store className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-black text-lg text-white tracking-tight">New Hope POS</span>
              <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-full text-[10px] font-black uppercase tracking-wider hidden sm:inline-block">
                v2.5 Hybrid
              </span>
            </div>
            <span className="text-[11px] text-slate-400 font-medium block">
              Multi-Sector Commerce & Smart POS OS
            </span>
          </div>
        </div>

        {/* Center Desktop Links */}
        <nav className="hidden lg:flex items-center space-x-6 text-xs font-bold text-slate-300">
          <a href="#simulator" className="hover:text-amber-400 transition-colors flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>Simulator POS</span>
          </a>
          <a href="#fitur" className="hover:text-amber-400 transition-colors">Fitur Unggulan</a>
          <a href="#kalkulator-profit" className="hover:text-amber-400 transition-colors">Kalkulator Usaha</a>
          <a href="#sektor" className="hover:text-amber-400 transition-colors">5 Sektor Bisnis</a>
          <a href="#hardware" className="hover:text-amber-400 transition-colors">Perangkat Kasir</a>
          <a href="#pricing" className="hover:text-amber-400 transition-colors">Harga Paket</a>
          <a href="#blog" className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 font-black transition-all flex items-center space-x-1.5">
            <BookOpen className="w-3.5 h-3.5" />
            <span>Blog Harapan Baru</span>
          </a>
        </nav>

        {/* Right Action Buttons */}
        <div className="flex items-center space-x-3">
          {onOpenLogin && (
            <button
              onClick={onOpenLogin}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 font-bold text-xs border border-slate-700 transition-all cursor-pointer"
            >
              Masuk
            </button>
          )}

          <button
            onClick={() => onOpenRegister ? onOpenRegister() : handleOpenPOS()}
            className="px-4 lg:px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/25 transition-all transform hover:scale-[1.02] cursor-pointer flex items-center space-x-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 text-slate-950" />
            <span>{labelTrial}</span>
          </button>
        </div>
      </header>

      {/* Toast Notification Alert */}
      {registerSuccessMsg && (
        <div className="max-w-4xl mx-auto px-4">
          <div className="bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 px-5 py-4 rounded-2xl shadow-xl flex items-center justify-between animate-bounce">
            <div className="flex items-center space-x-3">
              <CheckCircle className="w-6 h-6 text-emerald-400 shrink-0" />
              <div>
                <p className="font-extrabold text-sm text-white">{registerSuccessMsg}</p>
                <p className="text-xs text-emerald-200">
                  Anda dapat langsung mencoba bertransaksi di halaman Kasir (POS).
                </p>
              </div>
            </div>
            <button
              onClick={() => setRegisterSuccessMsg(null)}
              className="p-1 hover:bg-emerald-500/30 rounded-lg text-emerald-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* 🎯 2. HERO SECTION WITH LIVE INTERACTIVE POS TERMINAL (SPOT ON & MOKA STYLE) */}
      <section className="relative px-4 lg:px-8 max-w-7xl mx-auto pt-6 lg:pt-10">
        {/* Ambient Lights */}
        <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[350px] bg-amber-500/10 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute top-1/3 right-10 w-[450px] h-[350px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Left Column: Headline & Value Prop */}
          <div className="lg:col-span-6 space-y-6 text-left">
            {/* Pill Tag */}
            <div className="inline-flex items-center space-x-2.5 px-4 py-1.5 rounded-full bg-slate-900/90 border border-slate-700/80 shadow-inner">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-extrabold text-amber-400 tracking-wide uppercase">
                Aplikasi Kasir Wirausaha Lengkap
              </span>
              <span className="text-slate-500 text-xs font-bold">•</span>
              <span className="text-slate-300 text-xs font-semibold">Tumbuh Lebih Cepat & Akurat</span>
            </div>

            {/* Master Headline */}
            <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-[1.14]">
              Satu Solusi Kasir Pintar untuk <br />
              <span className="bg-gradient-to-r from-amber-400 via-amber-200 to-amber-500 bg-clip-text text-transparent">
                Semua Langkah Maju Bisnis Anda
              </span>
            </h1>

            {/* Subtitle Value Prop */}
            <p className="text-slate-300 text-sm sm:text-base leading-relaxed font-medium">
              Kelola penjualan dengan cepat, terima pembayaran <b>QRIS otomatis</b>, pantau <b>stok bahan baku</b> secara presisi, dan dapatkan insight analitik cerdas bersama <b>Asisten AI Rp 0</b>. Lebih praktis, rapi, dan mudah digunakan.
            </p>

            {/* Action Buttons */}
            <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5">
              <button
                onClick={() => onOpenRegister ? onOpenRegister() : handleOpenPOS()}
                className="px-7 py-4 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-sm rounded-2xl shadow-xl shadow-amber-500/25 transition-all transform hover:scale-[1.02] active:scale-95 flex items-center justify-center space-x-2.5 cursor-pointer"
              >
                <Zap className="w-5 h-5 text-slate-950" />
                <span>Mulai {labelTrial}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={handleOpenPOS}
                className="px-6 py-4 bg-slate-900 hover:bg-slate-800 text-slate-200 font-extrabold text-sm rounded-2xl border border-slate-700 shadow-md transition-all flex items-center justify-center space-x-2.5 cursor-pointer active:scale-95"
              >
                <Play className="w-4 h-4 text-amber-400" />
                <span>Buka Live Demo Kasir Full</span>
              </button>
            </div>

            {/* Guarantee Badges */}
            <div className="pt-2 flex flex-wrap items-center gap-4 text-xs text-slate-400 font-semibold">
              <span className="flex items-center space-x-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>100% Bebas Biaya Setup</span>
              </span>
              <span className="flex items-center space-x-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Bisa Pakai HP / Tablet Sendiri</span>
              </span>
              <span className="flex items-center space-x-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Gratis Input 100 Menu</span>
              </span>
            </div>

            {/* Value Highlights */}
            <div className="pt-4 grid grid-cols-3 gap-3 border-t border-slate-800/80">
              <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-2xl">
                <div className="text-xl font-black text-amber-400 font-mono">&lt; 3 Detik</div>
                <div className="text-[11px] text-slate-300 font-bold">Checkout Cepat</div>
              </div>
              <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-2xl">
                <div className="text-xl font-black text-emerald-400 font-mono">100% Akurat</div>
                <div className="text-[11px] text-slate-300 font-bold">Laporan Real-Time</div>
              </div>
              <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-2xl">
                <div className="text-xl font-black text-blue-400 font-mono">Offline-First</div>
                <div className="text-[11px] text-slate-300 font-bold">Jualan Tanpa Jeda</div>
              </div>
            </div>
          </div>

          {/* Right Column: 🕹️ INTERACTIVE LIVE POS PLAYGROUND TERMINAL (SPOT ON & MOKA STYLE) */}
          <div id="simulator" className="lg:col-span-6 relative">
            {/* Tablet Frame */}
            <div className="bg-slate-900 border-2 border-slate-700/80 rounded-[32px] p-3 sm:p-5 shadow-2xl shadow-amber-500/10 backdrop-blur-xl relative overflow-hidden ring-4 ring-slate-800/50">
              {/* Tablet Header Bar */}
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800 text-xs">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-rose-500/80" />
                  <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                  <span className="font-mono text-[11px] text-slate-400 ml-2 font-bold">
                    Terminal Kasir #01 &bull; Live Interactive Playground
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-black border border-emerald-500/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <span>Coba Tambah Menu!</span>
                </span>
              </div>

              {/* Sector Quick Switcher inside Terminal */}
              <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none mb-3">
                {(Object.keys(simulatorCatalog) as BusinessSector[]).map((sec) => (
                  <button
                    key={sec}
                    onClick={() => setSimSector(sec)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold whitespace-nowrap transition-all cursor-pointer ${
                      simSector === sec
                        ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                        : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {BUSINESS_PRESETS[sec]?.name || sec}
                  </button>
                ))}
              </div>

              {/* Two Column POS Interface Mock: Catalog & Cart */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                {/* Product Catalog Grid (7 Cols) */}
                <div className="sm:col-span-7 space-y-2">
                  <div className="text-[10px] font-black uppercase text-slate-400 tracking-wider flex items-center justify-between">
                    <span>Katalog ({BUSINESS_PRESETS[simSector]?.name})</span>
                    <span className="text-amber-400">Pilih item ➔</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {simulatorCatalog[simSector].map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleAddSimItem(item)}
                        className="p-3 bg-slate-950/80 hover:bg-amber-500/10 hover:border-amber-500/60 border border-slate-800 rounded-2xl text-left transition-all active:scale-95 group cursor-pointer space-y-1.5"
                      >
                        <div className="text-2xl">{item.icon}</div>
                        <div>
                          <p className="text-xs font-extrabold text-white group-hover:text-amber-400 transition-colors line-clamp-1">
                            {item.name}
                          </p>
                          <p className="text-xs font-black text-amber-400 font-mono">
                            {formatRupiah(item.price)}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Live Cart & Instant Checkout (5 Cols) */}
                <div className="sm:col-span-5 bg-slate-950/90 border border-slate-800 rounded-2xl p-3 flex flex-col justify-between space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div className="flex items-center space-x-1.5 text-xs font-black text-white">
                        <ShoppingCart className="w-3.5 h-3.5 text-amber-400" />
                        <span>Keranjang ({simCart.reduce((sum, i) => sum + i.qty, 0)})</span>
                      </div>
                      {simCart.length > 0 && (
                        <button
                          onClick={() => setSimCart([])}
                          className="text-[10px] text-rose-400 hover:text-rose-300 font-bold"
                          title="Hapus Semua"
                        >
                          Reset
                        </button>
                      )}
                    </div>

                    {/* Cart Items List */}
                    <div className="space-y-1.5 max-h-[140px] overflow-y-auto scrollbar-thin pr-1">
                      {simCart.length === 0 ? (
                        <div className="py-6 text-center text-slate-500 text-xs">
                          <p>Keranjang kosong.</p>
                          <p className="text-[10px]">Klik menu di sebelah kiri!</p>
                        </div>
                      ) : (
                        simCart.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between text-xs py-1 border-b border-slate-800/40"
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <p className="font-bold text-white text-[11px] truncate">{item.name}</p>
                              <p className="text-[10px] text-amber-400 font-mono">
                                {formatRupiah(item.price * item.qty)}
                              </p>
                            </div>
                            <div className="flex items-center space-x-1 shrink-0">
                              <button
                                onClick={() => handleUpdateSimQty(item.id, -1)}
                                className="w-5 h-5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs"
                              >
                                -
                              </button>
                              <span className="w-4 text-center font-mono font-bold text-xs text-white">
                                {item.qty}
                              </span>
                              <button
                                onClick={() => handleUpdateSimQty(item.id, 1)}
                                className="w-5 h-5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Summary & Trigger Checkout */}
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Total + PPN (10%):</span>
                      <span className="font-mono font-black text-amber-400 text-sm">
                        {formatRupiah(simTotal)}
                      </span>
                    </div>

                    <button
                      disabled={simCart.length === 0}
                      onClick={handleTriggerSimPayment}
                      className="w-full py-2.5 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center space-x-1.5"
                    >
                      <QrCode className="w-4 h-4 text-slate-950" />
                      <span>Simulasi Bayar QRIS ➔</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Payment Success Modal Overlay */}
            {showSimPaymentModal && (
              <div className="absolute inset-0 z-30 bg-slate-950/95 backdrop-blur-md rounded-[32px] p-6 flex flex-col items-center justify-center text-center animate-fade-in space-y-4 border-2 border-amber-500/60 shadow-2xl">
                {!simPaymentDone ? (
                  <>
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/40">
                      <QrCode className="w-7 h-7" />
                    </div>

                    <div className="space-y-1">
                      <h4 className="font-black text-lg text-white">QRIS Dinamis Terverifikasi</h4>
                      <p className="text-xs text-slate-400">
                        Nominal terkunci otomatis &bull; Notifikasi pembayaran instan
                      </p>
                    </div>

                    <div className="p-3 bg-white rounded-2xl shadow-xl inline-block">
                      <div className="w-36 h-36 bg-slate-950 rounded-xl p-2 flex flex-col items-center justify-between border-4 border-amber-500">
                        <div className="flex justify-between w-full">
                          <div className="w-6 h-6 bg-white rounded-xs" />
                          <div className="w-6 h-6 bg-white rounded-xs" />
                        </div>
                        <span className="text-[10px] font-black text-amber-400 tracking-wider">
                          QRIS DINAMIS
                        </span>
                        <span className="text-xs font-black text-white font-mono">
                          {formatRupiah(simTotal)}
                        </span>
                        <div className="flex justify-between w-full">
                          <div className="w-6 h-6 bg-white rounded-xs" />
                          <div className="w-6 h-6 bg-white rounded-xs" />
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 w-full max-w-xs">
                      <button
                        onClick={handleExecuteSimSuccess}
                        className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs rounded-xl shadow-lg transition-all active:scale-95 cursor-pointer flex items-center justify-center space-x-1.5"
                      >
                        <Check className="w-4 h-4 stroke-[3]" />
                        <span>Simulasi Pelanggan Bayar</span>
                      </button>

                      <button
                        onClick={() => setShowSimPaymentModal(false)}
                        className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl"
                      >
                        Batal
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-3 animate-scale-up">
                    <div className="w-16 h-16 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/30">
                      <CheckCircle className="w-10 h-10 stroke-[2.5]" />
                    </div>
                    <h3 className="text-2xl font-black text-white">Pembayaran Berhasil!</h3>
                    <p className="text-xs text-emerald-400 font-bold">
                      Transaksi {formatRupiah(simTotal)} tercatat otomatis di laporan omset & Auto-Settlement H+1.
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Struk digital terkirim ke WhatsApp pelanggan & Stok bahan baku terpotong per gramatur.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 📊 3. TRUST BANNER & FINTECH PARTNERS */}
      <section className="border-y border-slate-800/80 bg-slate-900/40 py-8 px-4">
        <div className="max-w-7xl mx-auto text-center space-y-4">
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-slate-500">
            Terhubung Langsung dengan Ekosistem Pembayaran Perbankan & Hardware Kasir Indonesia
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-14 opacity-75 grayscale hover:grayscale-0 transition-all">
            <span className="font-mono font-black text-lg text-slate-300">QRIS Dinamis</span>
            <span className="font-mono font-black text-lg text-slate-300">Bank BCA</span>
            <span className="font-mono font-black text-lg text-slate-300">Bank Mandiri</span>
            <span className="font-mono font-black text-lg text-slate-300">Bank BRI</span>
            <span className="font-mono font-black text-lg text-slate-300">Sunmi POS</span>
            <span className="font-mono font-black text-lg text-slate-300">WhatsApp API</span>
          </div>
        </div>
      </section>

      {/* ✨ 3.5 FOUR CORE SOLUTION PILLARS (MOKA, MAJOO & SPOT ON STYLE) */}
      <section id="fitur" className="px-4 lg:px-8 max-w-7xl mx-auto space-y-8">
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-black uppercase">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Solusi Lengkap Wirausaha</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
            Semua Fitur yang Anda Butuhkan untuk Maju & Berkembang
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm font-medium">
            Dari pelayanan kasir kilat di meja depan hingga analisa finansial cerdas di ruang belakang, New Hope POS membuat operasional bisnis Anda lebih rapi, efisien, dan menguntungkan:
          </p>
        </div>

        {/* 4 Solution Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {solutionPillars.map((item, idx) => {
            const IconComp = item.icon;
            return (
              <div
                key={item.id}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-3xl p-6 lg:p-8 flex flex-col justify-between space-y-6 shadow-xl relative overflow-hidden transition-all group"
              >
                <div className="space-y-4">
                  {/* Top Badge & Icon */}
                  <div className="flex items-center justify-between">
                    <span className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider border ${item.bgColor} ${item.accentColor}`}>
                      {item.badge}
                    </span>
                    <div className={`w-11 h-11 rounded-2xl flex items-center justify-center bg-gradient-to-tr ${item.color} text-white shadow-md`}>
                      <IconComp className="w-5 h-5" />
                    </div>
                  </div>

                  {/* Title & Description */}
                  <div className="space-y-2">
                    <h3 className="text-lg sm:text-xl font-black text-white group-hover:text-amber-400 transition-colors">
                      {item.title}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-normal">
                      {item.desc}
                    </p>
                  </div>

                  {/* Benefit Highlight Box */}
                  <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 flex items-start space-x-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-slate-200 font-semibold leading-relaxed">
                      {item.benefit}
                    </p>
                  </div>
                </div>

                {/* Bottom Metric Bar */}
                <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block">Keunggulan Utama:</span>
                    <span className="text-xs font-bold text-slate-300">{item.metricLabel}</span>
                  </div>
                  <div className="text-right">
                    <span className={`text-xl sm:text-2xl font-black font-mono ${item.accentColor}`}>
                      {item.metric}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 🧮 3.8 INTERACTIVE GROWTH & EFFICIENCY CALCULATOR (SPOT ON & MAJOO STYLE) */}
      <section id="kalkulator-profit" className="px-4 lg:px-8 max-w-7xl mx-auto space-y-8">
        <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/30 rounded-3xl p-6 lg:p-12 border border-slate-800 shadow-2xl relative overflow-hidden">
          <div className="max-w-3xl space-y-3 mb-8">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs font-black uppercase">
              <Calculator className="w-3.5 h-3.5" />
              <span>Kalkulator Pertumbuhan Usaha</span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
              Hitung Potensi Penghematan Waktu & Pertumbuhan Bisnis Anda
            </h2>
            <p className="text-slate-300 text-xs sm:text-sm font-medium">
              Sesuaikan nilai di bawah dengan skala operasional toko Anda untuk melihat proyeksi efisiensi dan nilai pengembalian investasi (ROI):
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            {/* Left Column: Interactive Sliders */}
            <div className="lg:col-span-6 space-y-6 bg-slate-950/80 p-6 rounded-3xl border border-slate-800">
              {/* Slider 1: Revenue */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-slate-300">Estimasi Omset Toko / Bulan</span>
                  <span className="text-amber-400 font-mono text-base font-black">
                    {formatRupiah(monthlyRevenue)}
                  </span>
                </div>
                <input
                  type="range"
                  min={10000000}
                  max={250000000}
                  step={5000000}
                  value={monthlyRevenue}
                  onChange={(e) => setMonthlyRevenue(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-bold">
                  <span>Rp 10 Juta</span>
                  <span>Rp 100 Juta</span>
                  <span>Rp 250 Juta+</span>
                </div>
              </div>

              {/* Slider 2: Daily Transactions */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-slate-300">Rata-rata Transaksi per Hari</span>
                  <span className="text-emerald-400 font-mono text-base font-black">
                    {dailyTransactions} Struk / Hari
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={350}
                  step={5}
                  value={dailyTransactions}
                  onChange={(e) => setDailyTransactions(Number(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-bold">
                  <span>10 Struk</span>
                  <span>150 Struk</span>
                  <span>350+ Struk</span>
                </div>
              </div>

              {/* Slider 3: Staff Count */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-slate-300">Jumlah Kasir & Karyawan</span>
                  <span className="text-blue-400 font-mono text-base font-black">
                    {staffCount} Orang Staf
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={15}
                  step={1}
                  value={staffCount}
                  onChange={(e) => setStaffCount(Number(e.target.value))}
                  className="w-full accent-blue-500 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-bold">
                  <span>1 Kasir</span>
                  <span>7 Staf</span>
                  <span>15+ Staf</span>
                </div>
              </div>
            </div>

            {/* Right Column: Calculated Results Box */}
            <div className="lg:col-span-6 space-y-4">
              <div className="bg-slate-950 p-6 lg:p-8 rounded-3xl border-2 border-amber-500/50 shadow-2xl space-y-6">
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
                    Hasil Analisa Proyeksi New Hope POS
                  </span>
                  <h3 className="text-xl sm:text-2xl font-black text-white">
                    Efisiensi & Nilai Tambah Bisnis Anda:
                  </h3>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 space-y-1">
                    <span className="text-[11px] text-slate-400 font-bold">Optimalisasi Biaya Operasional</span>
                    <p className="text-xl sm:text-2xl font-black text-emerald-400 font-mono">
                      {formatRupiah(calculatedSavingsMonthly)}
                    </p>
                    <span className="text-[10px] text-slate-500 block">/ bulan dari efisiensi bahan & kasir</span>
                  </div>

                  <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 space-y-1">
                    <span className="text-[11px] text-slate-400 font-bold">Waktu Rekap Terhemat</span>
                    <p className="text-xl sm:text-2xl font-black text-amber-400 font-mono">
                      ~{calculatedTimeSavedHours} Jam
                    </p>
                    <span className="text-[10px] text-slate-500 block">/ bulan untuk fokus ekspansi</span>
                  </div>
                </div>

                <div className="p-4 bg-gradient-to-r from-emerald-500/10 to-amber-500/10 border border-emerald-500/30 rounded-2xl space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300">Estimasi Kenaikan Profit Bersih Tahunan:</span>
                    <span className="text-xs font-extrabold px-2 py-0.5 rounded bg-emerald-500 text-slate-950">
                      ROI {roiMultiplier}x Lipat
                    </span>
                  </div>
                  <p className="text-2xl sm:text-3xl font-black text-white font-mono">
                    +{formatRupiah(calculatedYearlyExtraProfit)} / tahun
                  </p>
                </div>

                <button
                  onClick={() => onOpenRegister ? onOpenRegister() : handleOpenPOS()}
                  className="w-full py-4 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-sm rounded-2xl shadow-xl shadow-amber-500/25 transition-all transform hover:scale-[1.02] cursor-pointer flex items-center justify-center space-x-2"
                >
                  <Zap className="w-5 h-5 text-slate-950" />
                  <span>Coba Gratis & Tingkatkan Profit Toko ➔</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 🕹️ 4. INTERACTIVE 5-SECTOR SHOWCASE (MOKA & MAJOO STYLE) */}
      <section id="sektor" className="px-4 lg:px-8 max-w-7xl mx-auto space-y-8">
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-black uppercase">
            <Building2 className="w-3.5 h-3.5" />
            <span>Spesialisasi 5 Sektor Bisnis</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
            Didesain Khusus Sesuai Karakteristik Usaha Anda
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm font-medium">
            Pilih sektor bisnis Anda untuk melihat fitur khusus dan menguji coba alur transaksinya:
          </p>
        </div>

        {/* 5 Sector Tabs Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {(Object.keys(BUSINESS_PRESETS) as BusinessSector[]).map((secKey) => {
            const preset = BUSINESS_PRESETS[secKey];
            const IconComp = sectorIcons[secKey] || Building2;
            const isSelected = selectedPresetSector === secKey;
            const isActiveInStore = settings.businessSector === secKey;

            return (
              <button
                key={secKey}
                onClick={() => setSelectedPresetSector(secKey)}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer relative flex flex-col justify-between space-y-3 ${
                  isSelected
                    ? 'border-amber-500 bg-amber-500/10 shadow-lg shadow-amber-500/10 ring-2 ring-amber-500/20'
                    : 'border-slate-800 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                {isActiveInStore && (
                  <span className="absolute top-2.5 right-2.5 px-2 py-0.5 bg-emerald-500 text-slate-950 text-[10px] font-black rounded-md shadow-xs">
                    Aktif
                  </span>
                )}

                <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white bg-gradient-to-br ${preset.bgGradient} shadow-md`}>
                  <IconComp className="w-5 h-5" />
                </div>

                <div>
                  <h4 className="font-extrabold text-sm text-white">{preset.name}</h4>
                  <p className="text-[11px] text-slate-400 font-medium truncate mt-0.5">{preset.categoryTag}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Sector Feature Showcase Box */}
        <div className="bg-slate-900 text-white rounded-3xl p-6 lg:p-10 space-y-8 border border-slate-800 relative overflow-hidden shadow-2xl">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-800">
            <div className="space-y-2 max-w-2xl">
              <div className="flex items-center space-x-2">
                <span className="px-3 py-1 bg-amber-500 text-slate-950 text-xs font-black rounded-full uppercase tracking-wide">
                  {selectedPreviewPreset.badge}
                </span>
                <span className="text-xs text-slate-400 font-medium">Alur Operasional: {selectedPreviewPreset.storeMode}</span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-black text-white">
                Solusi Kasir & Manajemen untuk {selectedPreviewPreset.name}
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed font-medium">
                {selectedPreviewPreset.description}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
              <button
                onClick={() => handleApplySector(selectedPresetSector)}
                className="px-6 py-3.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs sm:text-sm rounded-2xl shadow-lg transition-all flex items-center justify-center space-x-2 active:scale-95 cursor-pointer"
              >
                <Zap className="w-5 h-5 text-slate-950" />
                <span>Aktifkan Mode {selectedPreviewPreset.name}</span>
              </button>
            </div>
          </div>

          {/* Specialized Features Grid */}
          <div>
            <h4 className="text-xs font-extrabold text-amber-400 uppercase tracking-wider mb-4">
              Fitur Kunci Sektor {selectedPreviewPreset.name}:
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {selectedPreviewPreset.features.map((ft, idx) => (
                <div key={idx} className="bg-slate-800/90 p-5 rounded-2xl border border-slate-700/80 space-y-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-xs">
                    0{idx + 1}
                  </div>
                  <h5 className="font-extrabold text-sm text-white">{ft.title}</h5>
                  <p className="text-xs text-slate-400 leading-relaxed font-medium">{ft.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Sample Products Preview */}
          <div className="pt-4 border-t border-slate-800">
            <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider mb-3">
              Katalog & Item Contoh ({selectedPreviewPreset.products.length} Produk Siap Pakai):
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {selectedPreviewPreset.products.map((prod) => (
                <div
                  key={prod.id}
                  className="bg-slate-800/60 p-3 rounded-2xl border border-slate-700/60 flex items-center space-x-3"
                >
                  <img
                    src={prod.image}
                    alt={prod.name}
                    className="w-12 h-12 rounded-xl object-cover shrink-0 bg-slate-900"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-white truncate">{prod.name}</p>
                    <p className="text-xs font-black text-amber-400">{formatRupiah(prod.price)}</p>
                    <p className="text-[10px] text-slate-400 truncate">SKU: {prod.sku}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 📱 5. HARDWARE COMPATIBILITY & ECOSYSTEM (MAJOO & SPOT ON STYLE) */}
      <section id="hardware" className="px-4 lg:px-8 max-w-7xl mx-auto space-y-8">
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-xs font-black uppercase">
            <Smartphone className="w-3.5 h-3.5" />
            <span>Fleksibilitas Perangkat Kasir</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
            Gunakan di Berbagai Perangkat Pilihan Anda
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm font-medium">
            Bebas gunakan smartphone, tablet, iPad, laptop, hingga perangkat POS all-in-one tanpa biaya lisensi tambahan:
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-xl hover:border-blue-500/40 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/20 text-blue-400 flex items-center justify-center">
              <Smartphone className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-black text-white">HP Android & iOS</h3>
            <p className="text-xs text-slate-400 leading-relaxed font-medium">
              Sempurna untuk pelayan pesan langsung di meja (Waitress App), kurir antar-jemput laundry, dan kasir mobile.
            </p>
            <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30 inline-block">
              Mobilitas Tinggi
            </span>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-xl hover:border-amber-500/40 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Tablet className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-black text-white">iPad & Android Tablet</h3>
            <p className="text-xs text-slate-400 leading-relaxed font-medium">
              Standar meja kasir modern resto, kafe, dan barbershop dengan tampilan tombol visual besar yang elegan.
            </p>
            <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 inline-block">
              Pilihan Utama
            </span>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-xl hover:border-emerald-500/40 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Monitor className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-black text-white">Laptop & PC Windows</h3>
            <p className="text-xs text-slate-400 leading-relaxed font-medium">
              Ideal untuk kasir minimarket ribuan SKU dengan barcode scanner tembak dan manajemen back-office admin.
            </p>
            <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 inline-block">
              Scan Cepat
            </span>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-xl hover:border-purple-500/40 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
              <Printer className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-black text-white">Sunmi & Printer Termal</h3>
            <p className="text-xs text-slate-400 leading-relaxed font-medium">
              Kompatibel dengan perangkat Android POS all-in-one (Sunmi/iMin), printer Bluetooth 58/80mm, dan laci kasir otomatis.
            </p>
            <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded bg-purple-500/10 text-purple-300 border border-purple-500/30 inline-block">
              Plug & Play
            </span>
          </div>
        </div>
      </section>

      {/* 🤖 6. INTERACTIVE AI COPILOT SIMULATOR (ZERO-COST VALUE) */}
      <section id="ai-copilot" className="px-4 lg:px-8 max-w-7xl mx-auto space-y-8">
        <div className="bg-gradient-to-br from-slate-900 via-indigo-950/40 to-slate-900 rounded-3xl p-6 lg:p-12 border border-slate-800 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="max-w-3xl space-y-3 mb-8">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/30 text-xs font-black uppercase">
              <Bot className="w-3.5 h-3.5" />
              <span>Smart Business Intelligence &bull; Biaya Rp 0</span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
              Asisten Analisa Bisnis Pribadi &bull; Jawaban Tepat dalam &lt; 5ms
            </h2>
            <p className="text-slate-300 text-xs sm:text-sm leading-relaxed font-medium">
              New Hope POS dibekali <b>3-Layer Deterministic Rule Engine</b> cerdas yang membaca database transaksi toko Anda secara instan — memberikan rekomendasi restock, analisis menu terlaris, dan evaluasi penjualan tanpa biaya token tambahan.
            </p>
          </div>

          {/* Simulator Interactive Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Prompt Buttons */}
            <div className="lg:col-span-5 space-y-3">
              <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">
                Coba Pilih Pertanyaan Simulasi:
              </p>
              {aiSimulations.map((sim, idx) => {
                const isActive = activeAIQueryIdx === idx;
                return (
                  <button
                    key={idx}
                    onClick={() => setActiveAIQueryIdx(idx)}
                    className={`w-full p-4 rounded-2xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                      isActive
                        ? 'bg-purple-600/20 border-purple-500 text-white shadow-lg ring-1 ring-purple-500/30'
                        : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="space-y-1 pr-2">
                      <span className="text-[10px] font-bold uppercase text-purple-400 block">
                        {sim.tag}
                      </span>
                      <p className="text-xs sm:text-sm font-bold text-white">{sim.query}</p>
                    </div>
                    <ArrowRight className={`w-4 h-4 shrink-0 transition-transform ${isActive ? 'text-amber-400 translate-x-1' : 'text-slate-600'}`} />
                  </button>
                );
              })}
            </div>

            {/* Right Live Simulated Response Box */}
            <div className="lg:col-span-7 bg-slate-950/90 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-black text-white block">New Hope Smart Copilot</span>
                    <span className="text-[10px] text-emerald-400 font-bold">Online &bull; Live Database View</span>
                  </div>
                </div>

                <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-[10px] font-bold">
                  {aiSimulations[activeAIQueryIdx].badge}
                </span>
              </div>

              <div className="p-4 bg-slate-900/80 rounded-2xl border border-slate-800 space-y-2">
                <p className="text-xs font-bold text-purple-300">
                  Pertanyaan: {aiSimulations[activeAIQueryIdx].query}
                </p>
              </div>

              <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800/80 space-y-3">
                <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-medium">
                  {aiSimulations[activeAIQueryIdx].answer}
                </p>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Sumber Data: <code className="text-amber-400 font-mono">contract.merchant_revenue</code></span>
                  <span className="text-emerald-400 font-bold">Biaya Token: Rp 0 (Deterministik)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 🏷️ 8. OFFICIAL TRANSPARENT PRICING */}
      <section id="pricing" className="px-4 lg:px-8 max-w-7xl mx-auto space-y-8">
        <div className="text-center space-y-4 max-w-3xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-black uppercase">
            <DollarSign className="w-3.5 h-3.5" />
            <span>Pilihan Paket Langganan</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
            Harga Transparan untuk Setiap Skala Bisnis
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm font-medium">
            Mulai dari paket gratis hingga fitur enterprise multi-outlet. Sesuaikan dengan fase pertumbuhan usaha Anda:
          </p>

          {/* Monthly vs Annual Toggle */}
          <div className="inline-flex items-center bg-slate-900 p-1.5 rounded-2xl border border-slate-800 mt-4">
            <button
              onClick={() => setIsYearlyBilling(false)}
              className={`px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                !isYearlyBilling ? 'bg-amber-500 text-slate-950 shadow-md font-black' : 'text-slate-400 hover:text-white'
              }`}
            >
              Ditagih Bulanan
            </button>
            <button
              onClick={() => setIsYearlyBilling(true)}
              className={`px-5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer ${
                isYearlyBilling ? 'bg-amber-500 text-slate-950 shadow-md font-black' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>Ditagih Tahunan</span>
              <span className="px-2 py-0.5 bg-rose-500 text-white text-[9px] font-black rounded-md uppercase animate-pulse">
                Hemat 20%
              </span>
            </button>
          </div>
        </div>

        {/*
          * KARTU HARGA MEMAKAI DESAIN BARU, ANGKA DARI KATALOG.
          *
          * Versi tampilan menuliskan angkanya langsung di JSX — "45–90 hari",
          * "Maksimal 30 Item Produk", "Up to 4 Outlet", "AI Analyst 3x/bulan".
          * Begitu katalog di panel admin berubah, halaman ini tetap menjanjikan
          * angka lama kepada calon pelanggan, dan tidak ada yang akan
          * menyadarinya sampai ada yang protes karena merasa dijanjikan lebih.
          *
          * "Up to 4 Outlet" untuk Pro sudah salah saat digabung: paketnya 5.
          *
          * Yang dipakai di bawah tetap rancangan visual yang sama — kisi tiga
          * kolom, pita POPULER, daftar bercentang — hanya isinya yang dibaca
          * dari /api/v1/subscription/plans.
          */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 max-w-7xl mx-auto">
          {paket.length === 0 ? (
            <div className="col-span-full text-center text-xs text-slate-500 py-12 font-medium">
              Memuat daftar paket…
            </div>
          ) : (
            paket.map((pk) => {
              // Paket berbayar termurah yang ditandai POPULER — dipilih dari
              // katalog, bukan dipatok pada satu id. Mengganti nama paket atau
              // menambah tingkatan tidak boleh membuat penandanya hilang.
              const termurahBerbayar = paket
                .filter((x) => x.priceIdr > 0)
                .sort((a, b) => a.priceIdr - b.priceIdr)[0];
              const populer = termurahBerbayar?.id === pk.id;

              // Harga tahunan disimpan sebagai harga PER BULAN bila ditagih
              // tahunan, jadi setahun = 12x. Menampilkannya sebagai harga
              // tahunan apa adanya akan terbaca 12 kali lebih murah.
              const adaTahunan = pk.priceYearlyIdr != null && pk.priceYearlyIdr > 0;
              const hargaBulan =
                isYearlyBilling && adaTahunan ? Number(pk.priceYearlyIdr) : pk.priceIdr;
              const hematSetahun = adaTahunan
                ? (pk.priceIdr - Number(pk.priceYearlyIdr)) * 12
                : 0;

              const percobaan = (pk.trialDays ?? 0) > 0;

              return (
                <div
                  key={pk.id}
                  className={
                    populer
                      ? 'bg-gradient-to-b from-slate-900 via-slate-900 to-amber-950/20 rounded-3xl border-2 border-amber-500/80 p-6 lg:p-8 flex flex-col justify-between space-y-6 shadow-2xl relative'
                      : 'bg-slate-900 rounded-3xl border border-slate-800 p-6 lg:p-8 flex flex-col justify-between space-y-6 shadow-xl relative'
                  }
                >
                  {populer && (
                    <div className="absolute -top-3 right-6 bg-gradient-to-r from-amber-500 to-amber-400 text-slate-950 text-[10px] font-black px-3.5 py-1 rounded-full uppercase tracking-wider shadow-md">
                      PALING POPULER
                    </div>
                  )}

                  <div className="space-y-4">
                    <span
                      className={
                        populer
                          ? 'inline-block text-[10px] font-black uppercase px-2.5 py-1 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : 'inline-block text-[10px] font-black uppercase px-2.5 py-1 rounded bg-slate-800 text-slate-400 border border-slate-700'
                      }
                    >
                      Tier Level {pk.tierLevel}
                      {percobaan && ` \u2022 ${pk.trialDays} hari gratis`}
                    </span>

                    <h3 className={`text-xl font-black ${populer ? 'text-amber-400' : 'text-white'}`}>
                      {pk.name}
                    </h3>

                    <div className="border-b border-slate-800 pb-4">
                      <div className="flex items-baseline">
                        <span className="text-3xl font-black font-mono text-white">
                          {ringkasRupiah(hargaBulan)}
                        </span>
                        <span className="text-xs text-slate-500 font-bold ml-1">/ bulan</span>
                      </div>
                      {isYearlyBilling && hematSetahun > 0 && (
                        <p className="text-[10px] text-amber-400 font-bold mt-1">
                          Ditagih {ringkasRupiah(Number(pk.priceYearlyIdr) * 12)} / tahun
                          {` (Hemat ${ringkasRupiah(hematSetahun)})`}
                        </p>
                      )}
                    </div>

                    {/* Tiga angka yang paling sering ditanya, langsung dari paket. */}
                    <ul className="space-y-3 text-xs font-medium text-slate-300">
                      <li className="flex items-center space-x-2">
                        <CheckCircle2 className={`w-4 h-4 shrink-0 ${populer ? 'text-amber-400' : 'text-emerald-400'}`} />
                        <span>
                          <b>{labelBatas(pk.maxOutlets)}</b> outlet
                          {pk.extraOutletPriceIdr
                            ? ` (+${ringkasRupiah(pk.extraOutletPriceIdr)}/outlet tambahan)`
                            : ''}
                        </span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <CheckCircle2 className={`w-4 h-4 shrink-0 ${populer ? 'text-amber-400' : 'text-emerald-400'}`} />
                        <span><b>{labelBatas(pk.productLimit)}</b> produk</span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <CheckCircle2 className={`w-4 h-4 shrink-0 ${populer ? 'text-amber-400' : 'text-emerald-400'}`} />
                        <span>AI Analyst: <b>{pk.aiQuotaMonthly}x / bulan</b></span>
                      </li>
                      {pk.features.slice(0, 4).map((f) => (
                        <li key={f} className="flex items-center space-x-2">
                          <CheckCircle2 className={`w-4 h-4 shrink-0 ${populer ? 'text-amber-400' : 'text-emerald-400'}`} />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <button
                    onClick={() => onOpenRegister?.()}
                    className={
                      populer
                        ? 'w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/25 transition-all cursor-pointer transform hover:scale-[1.02]'
                        : 'w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-extrabold text-xs transition-all cursor-pointer'
                    }
                  >
                    {pk.priceIdr === 0 ? 'Mulai Gratis Sekarang' : `Pilih Paket ${pk.name}`}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* 🚀 9. WHITE-GLOVE ONBOARDING HOOK */}
      <section className="px-4 lg:px-8 max-w-5xl mx-auto">
        <div className="bg-gradient-to-r from-emerald-950/60 via-slate-900 to-slate-900 border border-emerald-500/30 rounded-3xl p-6 lg:p-10 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl">
          <div className="space-y-2 text-center md:text-left">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-black uppercase">
              <MessageCircle className="w-3.5 h-3.5" />
              <span>Gratis Layanan Migrasi & Input Menu</span>
            </div>
            <h3 className="text-xl sm:text-2xl font-black text-white">
              Ingin Dibantu Memasukkan Daftar Menu Toko Anda?
            </h3>
            <p className="text-xs sm:text-sm text-slate-300 max-w-xl font-medium">
              Cukup foto daftar menu, nota, atau kirim file Excel katalog Anda ke WhatsApp kami. Tim New Hope POS akan meng-input seluruh 100 produk Anda <b>100% GRATIS</b> dan siap dipakai jualan dalam 3 jam!
            </p>
          </div>

          <a
            href="https://wa.me/6281234567890?text=Halo%20Tim%20New%20Hope%20POS,%20saya%20mau%20dibantu%20input%20menu%20dan%20coba%20demo%20kasir"
            target="_blank"
            rel="noreferrer"
            className="px-6 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs sm:text-sm rounded-2xl shadow-lg transition-all flex items-center space-x-2 shrink-0 cursor-pointer"
          >
            <MessageCircle className="w-4 h-4 text-slate-950" />
            <span>Kirim Foto Menu via WhatsApp</span>
          </a>
        </div>
      </section>

      {/* 💬 10. REAL CUSTOMER TESTIMONIALS (MOKA & MAJOO STYLE) */}
      <section className="px-4 lg:px-8 max-w-7xl mx-auto space-y-8">
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-black uppercase">
            <Award className="w-3.5 h-3.5" />
            <span>Kisah Sukses Pengguna</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
            Dipercaya oleh Ribuan Pemilik Usaha di Seluruh Indonesia
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {testimonials.map((t, idx) => {
            const IconC = t.icon;
            return (
              <div
                key={idx}
                className="bg-slate-900 border border-slate-800 p-6 rounded-3xl flex flex-col justify-between space-y-4 shadow-xl relative"
              >
                <div className="space-y-3">
                  <div className="flex items-center space-x-1 text-amber-400">
                    {[...Array(t.rating)].map((_, i) => (
                      <Star key={i} className="w-4 h-4 fill-amber-400" />
                    ))}
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed font-medium italic">
                    "{t.quote}"
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-800 flex items-center space-x-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white bg-gradient-to-tr ${t.color}`}>
                    <IconC className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h5 className="text-xs font-extrabold text-white truncate">{t.name}</h5>
                    <p className="text-[10px] text-amber-400 truncate">{t.role}</p>
                    <p className="text-[10px] text-slate-400 truncate">{t.business}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 📚 10.5 BLOG HARAPAN BARU HIGHLIGHTS SECTION */}
      <section id="blog-section" className="px-4 lg:px-8 max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-black uppercase">
              <BookOpen className="w-3.5 h-3.5" />
              <span>Pusat Edukasi & Strategi Bisnis</span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
              Blog Harapan Baru: Tips & Panduan Praktis UMKM
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 font-medium">
              Pelajari strategi bisnis kafe, manajemen usaha laundry kiloan, hingga panduan pembayaran non-tunai modern.
            </p>
          </div>

          <a
            href="#blog"
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-amber-400 border border-slate-700 hover:border-amber-500/50 rounded-xl text-xs font-black transition-all flex items-center space-x-1.5 w-fit"
          >
            <span>Buka Semua Artikel Blog</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <a
            href="#blog/cara-membuka-kafe-modal-10-juta-sukses"
            className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden p-5 space-y-3 hover:border-amber-500/50 hover:shadow-xl transition-all group block"
          >
            <div className="relative aspect-video rounded-2xl overflow-hidden bg-slate-950">
              <img
                src="https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&q=80&w=800"
                alt="Cara Buka Kafe Modal 10 Juta"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <span className="absolute top-2.5 left-2.5 px-2 py-0.5 bg-slate-950/80 backdrop-blur-md text-amber-400 rounded text-[9px] font-black uppercase">
                Kuliner & F&B
              </span>
            </div>
            <h3 className="font-extrabold text-sm text-white group-hover:text-amber-400 transition-colors line-clamp-2">
              Panduan Lengkap: Cara Membuka Kafe Modal 10 Juta dengan Sistem Kasir Otomatis
            </h3>
            <p className="text-xs text-slate-400 line-clamp-2">
              Langkah praktis memulai bisnis kedai kopi kekinian, menghitung HPP resep, dan mengelola stok bahan baku.
            </p>
          </a>

          <a
            href="#blog/rahasia-sukses-bisnis-laundry-kiloan-omset-puluhan-juta"
            className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden p-5 space-y-3 hover:border-amber-500/50 hover:shadow-xl transition-all group block"
          >
            <div className="relative aspect-video rounded-2xl overflow-hidden bg-slate-950">
              <img
                src="https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?auto=format&fit=crop&q=80&w=800"
                alt="Rahasia Bisnis Laundry Kiloan"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <span className="absolute top-2.5 left-2.5 px-2 py-0.5 bg-slate-950/80 backdrop-blur-md text-blue-400 rounded text-[9px] font-black uppercase">
                Laundry & Jasa
              </span>
            </div>
            <h3 className="font-extrabold text-sm text-white group-hover:text-amber-400 transition-colors line-clamp-2">
              Rahasia Sukses Bisnis Laundry Kiloan: Cara Atur Status Cucian & Kirim Nota WA
            </h3>
            <p className="text-xs text-slate-400 line-clamp-2">
              Strategi mengelola cucian pelanggan secara rapi dan mendongkrak omset laundry hingga puluhan juta per bulan.
            </p>
          </a>

          <a
            href="#blog/revolusi-qris-dinamis-pos-umkm-tanpa-biaya-admin"
            className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden p-5 space-y-3 hover:border-amber-500/50 hover:shadow-xl transition-all group block"
          >
            <div className="relative aspect-video rounded-2xl overflow-hidden bg-slate-950">
              <img
                src="https://images.unsplash.com/photo-1556742049-0a67e557b640?auto=format&fit=crop&q=80&w=800"
                alt="Revolusi QRIS Dinamis POS"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <span className="absolute top-2.5 left-2.5 px-2 py-0.5 bg-slate-950/80 backdrop-blur-md text-emerald-400 rounded text-[9px] font-black uppercase">
                FinTech & QRIS
              </span>
            </div>
            <h3 className="font-extrabold text-sm text-white group-hover:text-amber-400 transition-colors line-clamp-2">
              Revolusi QRIS Dinamis di Kasir POS: Kenapa Non-Tunai Wajib untuk UMKM 2026
            </h3>
            <p className="text-xs text-slate-400 line-clamp-2">
              Keuntungan QRIS Dinamis dibanding stiker meja statis: bebas salah ketik nominal dan pencairan H+1 otomatis.
            </p>
          </a>
        </div>
      </section>

      {/* ❓ 11. FAQ SECTION */}
      <section id="faq" className="px-4 lg:px-8 max-w-4xl mx-auto space-y-6">
        <div className="text-center space-y-2 mb-8">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-slate-800 text-slate-300 text-xs font-bold">
            <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
            <span>Pertanyaan yang Sering Diajukan</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white">
            Semua yang Perlu Anda Ketahui
          </h2>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, idx) => {
            const isOpen = openFaqIdx === idx;
            return (
              <div
                key={idx}
                className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden transition-all"
              >
                <button
                  onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                  className="w-full p-5 text-left flex items-center justify-between space-x-4 cursor-pointer"
                >
                  <span className="font-extrabold text-sm text-white">{faq.q}</span>
                  {isOpen ? (
                    <ChevronUp className="w-5 h-5 text-amber-400 shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-500 shrink-0" />
                  )}
                </button>

                {isOpen && (
                  <div className="px-5 pb-5 text-xs sm:text-sm text-slate-300 leading-relaxed font-medium border-t border-slate-800/60 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 🏁 12. FINAL CALL-TO-ACTION BANNER */}
      <section className="px-4 lg:px-8 max-w-7xl mx-auto">
        <div className="bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 rounded-3xl p-8 lg:p-14 text-center text-slate-950 space-y-6 shadow-2xl relative overflow-hidden">
          <div className="space-y-3 max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-tight">
              Siap Membawa Bisnis Anda Melangkah Lebih Maju?
            </h2>
            <p className="text-slate-900 text-xs sm:text-base font-semibold max-w-2xl mx-auto">
              Bergabunglah dengan ribuan pemilik usaha di seluruh Indonesia yang telah menikmati kemudahan operasional kasir pintar. Coba gratis 45 hari tanpa komitmen.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <button
              onClick={() => onOpenRegister ? onOpenRegister() : handleOpenPOS()}
              className="w-full sm:w-auto px-8 py-4 bg-slate-950 hover:bg-slate-900 text-white font-black text-sm rounded-2xl shadow-xl transition-all cursor-pointer transform hover:scale-[1.03] active:scale-95 flex items-center justify-center space-x-2"
            >
              <Zap className="w-4 h-4 text-amber-400" />
              <span>Mulai Uji {labelTrial}</span>
            </button>

            <a
              href="https://wa.me/6281234567890?text=Halo%20Tim%20New%20Hope%20POS,%20saya%20ingin%20konsultasi%20paket%20kasir%20dan%20coba%20demo"
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto px-7 py-4 bg-white/30 hover:bg-white/40 text-slate-950 font-black text-sm rounded-2xl border border-slate-950/20 transition-all flex items-center justify-center space-x-2 cursor-pointer"
            >
              <Phone className="w-4 h-4" />
              <span>Konsultasi Gratis via WhatsApp</span>
            </a>
          </div>
        </div>
      </section>

      {/* 🔔 13. FLOATING SOCIAL PROOF TOAST TICKER (SPOT ON STYLE) */}
      {showLiveToast && (
        <div className="fixed bottom-5 left-5 z-50 animate-slide-up max-w-sm hidden sm:block">
          <div className="bg-slate-900/95 border border-slate-700/80 rounded-2xl p-3.5 shadow-2xl backdrop-blur-xl flex items-center space-x-3 text-xs">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-white truncate">
                  {liveSocialProofs[currentToastIdx].title}
                </span>
                <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  {liveSocialProofs[currentToastIdx].tag}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 truncate mt-0.5">
                {liveSocialProofs[currentToastIdx].action}
              </p>
              <span className="text-[9px] text-slate-500">
                {liveSocialProofs[currentToastIdx].time}
              </span>
            </div>
            <button
              onClick={() => setShowLiveToast(false)}
              className="text-slate-500 hover:text-slate-300 p-1 text-xs"
              title="Tutup notifikasi"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 🏛️ 14. FOOTER */}
      <footer className="border-t border-slate-800/80 pt-12 px-4 lg:px-8 max-w-7xl mx-auto text-xs text-slate-400 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-white font-black text-base">
              <Store className="w-5 h-5 text-amber-400" />
              <span>New Hope POS</span>
            </div>
            <p className="text-[11px] leading-relaxed font-medium">
              Sistem kasir multi-sektor cerdas dengan integrasi pembayaran QRIS Dinamis dan asisten bisnis AI deterministik berbiaya Rp 0.
            </p>
          </div>

          <div>
            <h5 className="font-extrabold text-white text-xs uppercase mb-3">5 Sektor Bisnis</h5>
            <ul className="space-y-2 text-[11px]">
              <li><a href="#sektor" className="hover:text-amber-400">Kafe & Restoran (F&B)</a></li>
              <li><a href="#sektor" className="hover:text-amber-400">Laundry Kiloan & Satuan</a></li>
              <li><a href="#sektor" className="hover:text-amber-400">Ritel & Minimarket</a></li>
              <li><a href="#sektor" className="hover:text-amber-400">Carwash & Auto Detailing</a></li>
              <li><a href="#sektor" className="hover:text-amber-400">Barbershop & Salon</a></li>
            </ul>
          </div>

          <div>
            <h5 className="font-extrabold text-white text-xs uppercase mb-3">Pusat Edukasi & Blog</h5>
            <ul className="space-y-2 text-[11px]">
              <li><a href="#blog" className="text-amber-400 font-bold hover:text-amber-300">Blog Harapan Baru (Semua)</a></li>
              <li><a href="#blog" className="hover:text-amber-400">Tips Buka Kafe & Resto</a></li>
              <li><a href="#blog" className="hover:text-amber-400">Strategi Usaha Laundry</a></li>
              <li><a href="#blog" className="hover:text-amber-400">Panduan QRIS Dinamis</a></li>
              <li><a href="#pricing" className="hover:text-amber-400">Paket Langganan POS</a></li>
            </ul>
          </div>

          <div>
            <h5 className="font-extrabold text-white text-xs uppercase mb-3">Kontak & Dukungan</h5>
            <p className="text-[11px] leading-relaxed">
              Graha Suryamas Blok K no 4 Sidoarjo, Jawa Timur<br />
              WhatsApp: 0812-3456-7890<br />
              Email: support@newhopepos.com
            </p>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-900 text-center text-[11px] text-slate-500">
          Hak Cipta &copy; 2026 New Hope POS. Seluruh Hak Cipta Dilindungi Undang-Undang.
        </div>
      </footer>
    </div>
  );
};
