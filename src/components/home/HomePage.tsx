import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { formatRupiah } from '../../utils/formatters';
import { BUSINESS_PRESETS, BusinessSector } from '../../data/businessPresets';
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
  AlertTriangle,
  Layers,
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
} from 'lucide-react';

interface HomePageProps {
  onStartDemo?: () => void;
  onOpenLogin?: () => void;
  onOpenRegister?: () => void;
  isStandaloneLanding?: boolean;
}

export const HomePage: React.FC<HomePageProps> = ({
  onStartDemo,
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

  // Registration Modal State
  const [registerSuccessMsg, setRegisterSuccessMsg] = useState<string | null>(null);

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

  const lowStockProducts = products.filter((p) => p.stock <= p.minStockAlert);
  const occupiedTables = tables.filter((t) => t.status === 'OCCUPIED').length;

  const currentActivePreset =
    BUSINESS_PRESETS[settings.businessSector || 'FNB'] || BUSINESS_PRESETS.FNB;

  const selectedPreviewPreset = BUSINESS_PRESETS[selectedPresetSector];

  const handleApplySector = (sector: BusinessSector, customName?: string) => {
    activateBusinessSector(sector, customName);
    setRegisterSuccessMsg(
      `Mode bisnis "${BUSINESS_PRESETS[sector].name}" berhasil diaktifkan! Katalog & produk contoh telah diperbarui.`
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

  const handleOpenPOS = () => {
    if (onStartDemo) {
      onStartDemo();
    } else {
      setActiveTab('pos');
    }
  };

  // AI Simulator Mock Prompts & Responses
  const aiSimulations = [
    {
      query: '📦 Stok apa yang paling kritis & mau habis?',
      tag: 'Deteksi Stok & HPP',
      badge: 'Rp 0 · < 5ms',
      answer:
        'Ada 2 bahan baku di bawah batas aman: 1) Biji Kopi Gayo sisa 1.8 Kg (cukup ~85 cup lagi, pesan sebelum Kamis), 2) Susu Fresh Milk sisa 3 Liter (estimasi habis besok pukul 14.30). Klik [Pesan Ulang] untuk hubungi supplier.',
    },
    {
      query: '💰 Berapa omset & estimasi laba bersih hari ini?',
      tag: 'Laporan Finansial Real-time',
      badge: 'Rp 0 · < 5ms',
      answer:
        'Total omset hari ini: Rp 3.840.000 dari 42 transaksi. Estimasi HPP bahan baku terpakai: Rp 1.450.000. Laba Kotor Harian: Rp 2.390.000 (Margin 62.2%). Penjualan naik 14% dibanding hari yang sama minggu lalu.',
    },
    {
      query: '🏆 Apa menu paling laris & menu yang harus dihapus?',
      tag: 'Analitik Menu & ABC',
      badge: 'Rp 0 · < 5ms',
      answer:
        'Produk Terlaris: "Es Kopi Susu Gula Aren" (58 cup terjual, kontribusi omset 38%). Produk Lambat (Dead Stock): "Pisang Keju Crispy" (0 terjual dalam 7 hari). Saran AI: Buat paket kombo kombo bundling hemat untuk dorong penjualan snack.',
    },
    {
      query: '⭐ Siapa staf/kasir dengan performa terbaik shift ini?',
      tag: 'Audit Staf & Komisi',
      badge: 'Rp 0 · < 5ms',
      answer:
        'Budi Santoso mencatat 28 transaksi kasir dengan total penjualan Rp 2.450.000 tanpa selisih void. Mas Alex (Stylist) menyelesaikan 8 pengerjaan potong rambut dengan estimasi komisi jasa Rp 240.000.',
    },
  ];

  // Testimonials Data
  const testimonials = [
    {
      quote:
        'Sejak pakai New Hope POS, kebocoran susu & biji kopi kami turun 0%. Fitur resep gramaturnya otomatis potong stok saat kasir jualan. Fitur split bill mejanya bikin barista & kasir kami senang banget!',
      name: 'Doni Pratama',
      role: 'Owner & Head Barista',
      business: 'Kopi Senayan Jakarta',
      sector: 'F&B & Resto',
      rating: 5,
      icon: Coffee,
      color: 'from-amber-500 to-amber-700',
    },
    {
      quote:
        'Status pengerjaan cuci, kering, setrika dan nota otomatis via WhatsApp membuat komplain baju hilang atau tertukar jadi NOL. Pelanggan makin percaya dan omset laundry kami naik 35%!',
      name: 'Ibu Hj. Siti Aminah',
      role: 'Pemilik Laundry Kiloan',
      business: 'Dago Express Laundry Bandung',
      sector: 'Laundry Service',
      rating: 5,
      icon: Shirt,
      color: 'from-blue-500 to-indigo-700',
    },
    {
      quote:
        'Scan barcode super responsif, scan ratusan SKU minimarket tanpa lemot. Laporan laba kotor harian langsung kelihatan tanpa pusing hitung buku manual tiap malam.',
      name: 'Hendra Wijaya',
      role: 'Pengelola Toko Sembako & Ritel',
      business: 'Toko Berkah Sentosa Surabaya',
      sector: 'Ritel & Minimarket',
      rating: 5,
      icon: ShoppingBag,
      color: 'from-emerald-500 to-teal-700',
    },
    {
      quote:
        'Bagi hasil komisi kapster yang dulunya bikin pusing tiap malam Minggu, sekarang beres dalam 1 klik. Sistem antrean bookingnya bikin pelanggan salon kami betah.',
      name: 'Mas Alex Stylist',
      role: 'Master Barber & Founder',
      business: 'The Gentleman Barbershop Medan',
      sector: 'Barbershop & Grooming',
      rating: 5,
      icon: Scissors,
      color: 'from-purple-500 to-rose-700',
    },
  ];

  // FAQs Data
  const faqs = [
    {
      q: 'Apakah New Hope POS bisa tetap digunakan saat koneksi internet mati (Offline)?',
      a: 'Tentu saja! New Hope POS menggunakan arsitektur Offline-First yang tangguh. Kasir Anda tetap bisa memproses pesanan, membuka laci kasir, dan mencetak struk saat internet terputus. Data transaksi akan otomatis tersinkronisasi ke cloud begitu internet terhubung kembali tanpa risiko duplikasi data.',
    },
    {
      q: 'Bagaimana jika saya malas mengetik ulang ratusan menu dari aplikasi kasir lama?',
      a: 'Tenang saja! Kami menyediakan layanan White-Glove Onboarding GRATIS. Cukup foto buku menu, nota, atau file Excel katalog lama Anda dan kirimkan ke tim WhatsApp kami. Tim New Hope POS akan meng-input seluruh data produk & resep Anda sampai siap jualan dalam waktu kurang dari 3 jam.',
    },
    {
      q: 'Kapan uang dari transaksi pembayaran QRIS Dinamis masuk ke rekening saya?',
      a: 'Uang pembayaran QRIS Dinamis dan kartu otomatis dicairkan (Auto-Settlement) langsung ke rekening bank mana saja (BCA, Mandiri, BRI, BNI, dll) setiap H+1 tanpa potongan biaya administrasi tersembunyi.',
    },
    {
      q: 'Apakah saya wajib membeli mesin kasir baru atau bisa pakai tablet/HP saya sendiri?',
      a: 'Anda TIDAK wajib membeli hardware baru! New Hope POS dapat berjalan mulus di perangkat apa pun yang Anda miliki: HP Android, Tablet, iPad, Laptop, PC Kasir Windows, maupun perangkat Android POS profesional seperti Sunmi, iMin, dan printer termal Bluetooth.',
    },
    {
      q: 'Apakah paket Free Trial 45 Hari benar-benar gratis tanpa kartu kredit?',
      a: '100% Gratis tanpa biaya tersembunyi dan tanpa perlu input kartu kredit. Anda mendapatkan akses penuh untuk menguji fitur kasir, analitik, dan manajemen stok di toko Anda secara nyata.',
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100 selection:bg-amber-500 selection:text-slate-950 space-y-12 lg:space-y-20 pb-24">
      
      {/* 🌟 1. STICKY TOP NAVIGATION BAR */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/80 px-4 lg:px-8 py-3.5 flex items-center justify-between transition-all">
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
              Multi-Sector Commerce & FinTech OS
            </span>
          </div>
        </div>

        {/* Center Desktop Links */}
        <nav className="hidden lg:flex items-center space-x-7 text-xs font-bold text-slate-300">
          <a href="#sektor" className="hover:text-amber-400 transition-colors">5 Sektor Bisnis</a>
          <a href="#ai-copilot" className="hover:text-amber-400 transition-colors">AI Copilot (Rp 0)</a>
          <a href="#inventory" className="hover:text-amber-400 transition-colors">Resep & Stok HPP</a>
          <a href="#pricing" className="hover:text-amber-400 transition-colors">Harga Paket</a>
          <a href="#blog" className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 font-black transition-all flex items-center space-x-1.5">
            <BookOpen className="w-3.5 h-3.5" />
            <span>Blog Harapan Baru</span>
          </a>
          <a href="#faq" className="hover:text-amber-400 transition-colors">FAQ</a>
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
            <span>Coba Gratis 45 Hari</span>
          </button>
        </div>
      </header>

      {/* Registration Toast Alert */}
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

      {/* 🎯 2. HERO SECTION */}
      <section className="relative px-4 lg:px-8 max-w-7xl mx-auto pt-6 lg:pt-12">
        {/* Glow Ambient Lights */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-amber-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-1/3 right-10 w-[400px] h-[300px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative z-10 text-center space-y-6 max-w-4xl mx-auto">
          {/* Top Pill Tag */}
          <div className="inline-flex items-center space-x-2.5 px-4 py-1.5 rounded-full bg-slate-900/90 border border-slate-700/80 shadow-inner">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-extrabold text-amber-400 tracking-wide uppercase">
              Sistem Kasir Multi-Sektor #1 di Indonesia
            </span>
            <span className="text-slate-500 text-xs font-bold">•</span>
            <span className="text-slate-300 text-xs font-semibold">AI Copilot Zero-Cost Built-in</span>
          </div>

          {/* Master Headline */}
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-[1.15]">
            Satu Aplikasi Kasir Pintar untuk <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-amber-400 via-amber-200 to-amber-500 bg-clip-text text-transparent">
              Kafe, Laundry, Ritel, Carwash & Barbershop
            </span>
          </h1>

          {/* Subtitle Value Prop */}
          <p className="text-slate-300 text-sm sm:text-lg leading-relaxed max-w-3xl mx-auto font-medium">
            Hentikan kebocoran bahan baku dapur, terima pembayaran <b>QRIS Dinamis</b> otomatis cair H+1, 
            dan pantau omset serta laba bersih toko secara real-time bersama <b>Asisten AI Cerdas Berbiaya Rp 0</b>.
          </p>

          {/* Primary Action Buttons */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => onOpenRegister ? onOpenRegister() : handleOpenPOS()}
              className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-sm rounded-2xl shadow-xl shadow-amber-500/25 transition-all transform hover:scale-[1.03] active:scale-95 flex items-center justify-center space-x-2.5 cursor-pointer"
            >
              <Zap className="w-5 h-5 text-slate-950" />
              <span>Mulai Uji Coba Gratis 45 Hari</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={handleOpenPOS}
              className="w-full sm:w-auto px-7 py-4 bg-slate-900 hover:bg-slate-800 text-slate-200 font-extrabold text-sm rounded-2xl border border-slate-700 shadow-md transition-all flex items-center justify-center space-x-2.5 cursor-pointer active:scale-95"
            >
              <Play className="w-4 h-4 text-amber-400" />
              <span>Buka Live Demo Kasir (Instant)</span>
            </button>
          </div>

          {/* Guarantee Badges */}
          <div className="pt-4 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-400 font-semibold">
            <span className="flex items-center space-x-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Tanpa Kartu Kredit</span>
            </span>
            <span className="flex items-center space-x-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Bisa Pakai HP / Tablet Sendiri</span>
            </span>
            <span className="flex items-center space-x-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Gratis Input Menu & Produk</span>
            </span>
          </div>
        </div>

        {/* Live Operational Quick Stats */}
        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-5xl mx-auto">
          <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl text-center space-y-1">
            <div className="text-2xl sm:text-3xl font-black text-amber-400 font-mono">5 Sektor</div>
            <div className="text-xs text-slate-400 font-bold">F&B, Laundry, Ritel, Jasa</div>
          </div>
          <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl text-center space-y-1">
            <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">&lt; 5 ms</div>
            <div className="text-xs text-slate-400 font-bold">Latensi AI Copilot (Rp 0)</div>
          </div>
          <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl text-center space-y-1">
            <div className="text-2xl sm:text-3xl font-black text-blue-400 font-mono">3-Tingkat</div>
            <div className="text-xs text-slate-400 font-bold">Kontrol Resep & HPP BOM</div>
          </div>
          <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl text-center space-y-1">
            <div className="text-2xl sm:text-3xl font-black text-purple-400 font-mono">H+1</div>
            <div className="text-xs text-slate-400 font-bold">Settlement QRIS Dinamis</div>
          </div>
        </div>
      </section>

      {/* 📊 3. TRUST BANNER & FINTECH PARTNERS */}
      <section className="border-y border-slate-800/80 bg-slate-900/40 py-8 px-4">
        <div className="max-w-7xl mx-auto text-center space-y-4">
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-slate-500">
            Terhubung Langsung dengan Ekosistem Pembayaran & Hardware Resmi Indonesia
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

      {/* 🕹️ 4. INTERACTIVE 5-SECTOR SHOWCASE */}
      <section id="sektor" className="px-4 lg:px-8 max-w-7xl mx-auto space-y-8">
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-black uppercase">
            <Building2 className="w-3.5 h-3.5" />
            <span>Multi-Sector Engine</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
            Didesain Khusus Sesuai Alur Kerja Bisnis Anda
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm font-medium">
            Pilih sektor usaha Anda di bawah ini untuk melihat fitur khusus dan menguji coba katalog produknya:
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
                <span className="text-xs text-slate-400 font-medium">Mode: {selectedPreviewPreset.storeMode}</span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-black text-white">
                {selectedPreviewPreset.name}
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
              Fitur Utama & Keunggulan Khusus Sektor {selectedPreviewPreset.name}:
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
              Contoh Katalog & Item Produk Siap Pakai ({selectedPreviewPreset.products.length} Item Contoh):
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

      {/* 🤖 6. INTERACTIVE AI COPILOT SIMULATOR */}
      <section id="ai-copilot" className="px-4 lg:px-8 max-w-7xl mx-auto space-y-8">
        <div className="bg-gradient-to-br from-slate-900 via-indigo-950/40 to-slate-900 rounded-3xl p-6 lg:p-12 border border-slate-800 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="max-w-3xl space-y-3 mb-8">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/30 text-xs font-black uppercase">
              <Bot className="w-3.5 h-3.5" />
              <span>Smart Assistant Hybrid Engine</span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
              Asisten Bisnis Pribadi Cerdas &bull; Latensi &lt; 5ms & Biaya Rp 0
            </h2>
            <p className="text-slate-300 text-xs sm:text-sm leading-relaxed font-medium">
              Bukan sekadar chatbot umum yang menghabiskan biaya token API. New Hope POS memiliki <b>3-Layer Deterministic Rule Engine</b> yang menganalisis transaksi kasir Anda secara real-time tanpa membuat margin Anda tergerus.
            </p>
          </div>

          {/* Simulator Interactive Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Prompt Buttons */}
            <div className="lg:col-span-5 space-y-3">
              <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">
                Coba Klik Pertanyaan di Bawah Ini:
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

      {/* 📦 7. 3-LEVEL INVENTORY (BOM) SHOWCASE */}
      <section id="inventory" className="px-4 lg:px-8 max-w-7xl mx-auto space-y-8">
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-black uppercase">
            <Package className="w-3.5 h-3.5" />
            <span>Kontrol HPP & Resep Dapur</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
            Hentikan Kebocoran Bahan Baku & Resep Gramatur
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm font-medium">
            POS umum hanya mencatat barang jadi yang laku. New Hope POS mencatat hingga ke butir beras, gram kopi, dan mililiter sabun.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-xl">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-black">
              1
            </div>
            <h3 className="text-lg font-black text-white">Bahan Baku Mentah (Raw)</h3>
            <p className="text-xs text-slate-400 leading-relaxed font-medium">
              Catat pembelian stok dari supplier: Biji Kopi Gayo per Kg, Susu Fresh Milk per Liter, Daging Ayam Fillet, dan Biang Sampo Mobil.
            </p>
            <div className="p-3 bg-slate-950 rounded-xl font-mono text-xs text-amber-300 border border-slate-800">
              RAW-COFFEE-BEAN: 25 Kg
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-xl">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/20 text-blue-400 flex items-center justify-center font-black">
              2
            </div>
            <h3 className="text-lg font-black text-white">Bahan Setengah Jadi (WIP)</h3>
            <p className="text-xs text-slate-400 leading-relaxed font-medium">
              Pantau racikan yang disiapkan tim sebelum toko buka: Ekstraksi Konsentrat Espresso 1 Liter, Adonan Croissant, dan Biang Deterjen Laundry.
            </p>
            <div className="p-3 bg-slate-950 rounded-xl font-mono text-xs text-blue-300 border border-slate-800">
              WIP-ESP-01: 12 Liter Base
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-xl">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-black">
              3
            </div>
            <h3 className="text-lg font-black text-white">Barang Jadi & Resep (BOM)</h3>
            <p className="text-xs text-slate-400 leading-relaxed font-medium">
              Saat kasir menjual 1 Cup Es Kopi Susu, sistem otomatis memotong 30ml Espresso, 120ml Susu, 20ml Gula Aren, dan 1 Pcs Cup plastik.
            </p>
            <div className="p-3 bg-slate-950 rounded-xl font-mono text-xs text-emerald-300 border border-slate-800">
              HPP Terhitung Otomatis: Rp 7.500
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
            Investasi Terjangkau &bull; Tanpa Biaya Tersembunyi
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm font-medium">
            Mulai dari gratis selamanya hingga fitur enterprise multi-outlet. Sesuaikan dengan skala bisnis Anda.
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

        {/* Pricing Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {/* Card 1: Free Tier */}
          <div className="bg-slate-900 rounded-3xl border border-slate-800 p-6 lg:p-8 flex flex-col justify-between space-y-6 shadow-xl">
            <div className="space-y-4">
              <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded bg-slate-800 text-slate-400 border border-slate-700">
                Tier Level 1 &bull; Starter
              </span>
              <h3 className="text-xl font-black text-white">Free Tier / Trial</h3>
              <p className="text-xs text-slate-400 font-medium">
                Cocok untuk solo kios, warung baru, atau mencoba fitur kasir selama 45–90 hari.
              </p>

              <div className="border-b border-slate-800 pb-4">
                <span className="text-3xl font-black font-mono text-white">Rp 0</span>
                <span className="text-xs text-slate-500 font-bold ml-1">/ bulan</span>
              </div>

              <ul className="space-y-3 text-xs text-slate-300 font-medium">
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>1 Cabang Toko / Outlet</span></li>
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>Maksimal 30 Item Produk</span></li>
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>Basic POS Kasir & Struk</span></li>
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>Ringkasan Penjualan Harian</span></li>
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>AI Analyst: 3x / bulan</span></li>
              </ul>
            </div>

            <button
              onClick={() => onOpenRegister ? onOpenRegister() : handleOpenPOS()}
              className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-extrabold text-xs transition-all cursor-pointer"
            >
              Mulai Gratis Sekarang
            </button>
          </div>

          {/* Card 2: Tier Plus (Most Popular) */}
          <div className="bg-gradient-to-b from-slate-900 via-slate-900 to-amber-950/20 rounded-3xl border-2 border-amber-500/80 p-6 lg:p-8 flex flex-col justify-between space-y-6 shadow-2xl relative">
            <div className="absolute -top-3 right-6 bg-gradient-to-r from-amber-500 to-amber-400 text-slate-950 text-[10px] font-black px-3.5 py-1 rounded-full uppercase tracking-wider shadow-md">
              PALING POPULER
            </div>

            <div className="space-y-4">
              <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                Tier Level 2 &bull; Growing SMB
              </span>
              <h3 className="text-xl font-black text-amber-400">Tier Plus</h3>
              <p className="text-xs text-slate-300 font-medium">
                Pilihan utama kafe, laundry, dan toko yang membutuhkan kontrol stok dan analitik lengkap.
              </p>

              <div className="border-b border-slate-800 pb-4">
                <div className="flex items-baseline">
                  <span className="text-3xl font-black font-mono text-white">
                    {isYearlyBilling ? 'Rp 79.000' : 'Rp 99.000'}
                  </span>
                  <span className="text-xs text-slate-400 font-bold ml-1">/ bulan</span>
                </div>
                {isYearlyBilling && (
                  <p className="text-[10px] text-amber-400 font-bold mt-1">Ditagih Rp 948.000 / tahun (Hemat Rp 240rb)</p>
                )}
              </div>

              <ul className="space-y-3 text-xs text-slate-200 font-medium">
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" /><span><b>Up to 2 Outlet</b> (+59rb/outlet tambahan)</span></li>
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" /><span>Maksimal 100 Produk per Outlet</span></li>
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" /><span>Full POS + Manajemen Inventori Dasar</span></li>
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" /><span>Laporan & Dashboard Analitik Toko</span></li>
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" /><span>AI Analyst: <b>30x / bulan</b></span></li>
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" /><span>Struk Digital via WhatsApp</span></li>
              </ul>
            </div>

            <button
              onClick={() => onOpenRegister ? onOpenRegister() : handleOpenPOS()}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/25 transition-all cursor-pointer transform hover:scale-[1.02]"
            >
              Pilih Paket Tier Plus
            </button>
          </div>

          {/* Card 3: Tier Pro */}
          <div className="bg-slate-900 rounded-3xl border border-slate-800 p-6 lg:p-8 flex flex-col justify-between space-y-6 shadow-xl">
            <div className="space-y-4">
              <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded bg-slate-800 text-slate-400 border border-slate-700">
                Tier Level 3 &bull; Multi-Branch & Chain
              </span>
              <h3 className="text-xl font-black text-white">Tier Pro</h3>
              <p className="text-xs text-slate-400 font-medium">
                Untuk restoran dan bisnis multi-cabang yang butuh kontrol resep HPP & transfer stok.
              </p>

              <div className="border-b border-slate-800 pb-4">
                <div className="flex items-baseline">
                  <span className="text-3xl font-black font-mono text-white">
                    {isYearlyBilling ? 'Rp 239.000' : 'Rp 299.000'}
                  </span>
                  <span className="text-xs text-slate-500 font-bold ml-1">/ bulan</span>
                </div>
                {isYearlyBilling && (
                  <p className="text-[10px] text-emerald-400 font-bold mt-1">Ditagih Rp 2.868.000 / tahun (Hemat Rp 720rb)</p>
                )}
              </div>

              <ul className="space-y-3 text-xs text-slate-300 font-medium">
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span><b>Up to 4 Outlet</b> (+49rb/outlet tambahan)</span></li>
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span><b>UNLIMITED Produk</b> (Tanpa Batas)</span></li>
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span><b>Resep Bahan Baku (BOM) & WIP Stock</b></span></li>
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>Multi-Outlet Analytics & Laporan Konsolidasi</span></li>
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>AI Analyst: <b>90x / bulan</b></span></li>
                <li className="flex items-center space-x-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>Prioritas Support VIP 24/7</span></li>
              </ul>
            </div>

            <button
              onClick={() => onOpenRegister ? onOpenRegister() : handleOpenPOS()}
              className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-extrabold text-xs transition-all cursor-pointer"
            >
              Mulai Tier Pro
            </button>
          </div>
        </div>
      </section>

      {/* 🚀 9. WHITE-GLOVE ONBOARDING HOOK */}
      <section className="px-4 lg:px-8 max-w-5xl mx-auto">
        <div className="bg-gradient-to-r from-emerald-950/60 via-slate-900 to-slate-900 border border-emerald-500/30 rounded-3xl p-6 lg:p-10 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl">
          <div className="space-y-2 text-center md:text-left">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-black uppercase">
              <MessageCircle className="w-3.5 h-3.5" />
              <span>Gratis Layanan Setup Menu</span>
            </div>
            <h3 className="text-xl sm:text-2xl font-black text-white">
              Malas Ketik Ulang Menu & Produk Toko Anda?
            </h3>
            <p className="text-xs sm:text-sm text-slate-300 max-w-xl font-medium">
              Cukup foto daftar menu atau buku kasir lama Anda via WhatsApp. Tim New Hope POS akan meng-input seluruh 100 produk Anda <b>GRATIS</b> dalam 3 jam!
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

      {/* 💬 10. REAL CUSTOMER TESTIMONIALS */}
      <section className="px-4 lg:px-8 max-w-7xl mx-auto space-y-8">
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-black uppercase">
            <Award className="w-3.5 h-3.5" />
            <span>Testimoni Pengguna Nyata</span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
            Dipercaya oleh Ribuan Pemilik Bisnis di Seluruh Indonesia
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
              <span>Media Edukasi UMKM</span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
              Blog Harapan Baru: Tips & Strategi Bisnis
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 font-medium">
              Pelajari rahasia perhitungan HPP, panduan operasional kafe modal kecil, dan cara menghentikan kebocoran omset toko.
            </p>
          </div>

          <a
            href="#blog"
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-amber-400 border border-slate-700 hover:border-amber-500/50 rounded-xl text-xs font-black transition-all flex items-center space-x-1.5 w-fit"
          >
            <span>Buka Semua Artikel</span>
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
              Langkah praktis memulai bisnis kedai kopi kekinian, menghitung HPP resep, dan mencegah kebocoran susu/kopi.
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
              Strategi menghentikan komplain baju hilang/tertukar dan mendongkrak omset laundry hingga Rp 25 juta per bulan.
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
              Keuntungan QRIS Dinamis dibanding stiker meja: bebas salah ketik nominal dan pencairan H+1 otomatis.
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
              Siap Membawa Bisnis Anda Naik Kelas Hari Ini?
            </h2>
            <p className="text-slate-900 text-xs sm:text-base font-semibold max-w-2xl mx-auto">
              Bergabunglah dengan ribuan pemilik bisnis cerdas di seluruh Indonesia. Mulai sekarang tanpa biaya awal.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <button
              onClick={() => onOpenRegister ? onOpenRegister() : handleOpenPOS()}
              className="w-full sm:w-auto px-8 py-4 bg-slate-950 hover:bg-slate-900 text-white font-black text-sm rounded-2xl shadow-xl transition-all cursor-pointer transform hover:scale-[1.03] active:scale-95 flex items-center justify-center space-x-2"
            >
              <Zap className="w-4 h-4 text-amber-400" />
              <span>Mulai Uji Coba Gratis 45 Hari</span>
            </button>

            <a
              href="https://wa.me/6281234567890?text=Halo%20Tim%20New%20Hope%20POS,%20saya%20ingin%20tanya%20paket%20kasir"
              target="_blank"
              rel="noreferrer"
              className="w-full sm:w-auto px-7 py-4 bg-white/30 hover:bg-white/40 text-slate-950 font-black text-sm rounded-2xl border border-slate-950/20 transition-all flex items-center justify-center space-x-2 cursor-pointer"
            >
              <Phone className="w-4 h-4" />
              <span>Hubungi Tim Konsultan Kami</span>
            </a>
          </div>
        </div>
      </section>

      {/* 🏛️ 13. FOOTER */}
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
