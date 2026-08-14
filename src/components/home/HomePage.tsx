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

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50/50 p-4 lg:p-8 space-y-8 animate-fade-in">
      {/* Top Navbar when in Standalone Landing Mode */}
      {isStandaloneLanding && (
        <header className="flex items-center justify-between p-4 bg-slate-900 text-white rounded-2xl shadow-md border border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-amber-500 text-slate-950 rounded-xl font-bold">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <span className="font-black text-base text-white block">New Hope POS</span>
              <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Multi-Sector Smart POS</span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {onOpenLogin && (
              <button
                onClick={onOpenLogin}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700 transition-all cursor-pointer"
              >
                Masuk (Login)
              </button>
            )}
            <button
              onClick={handleOpenPOS}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-md shadow-amber-500/20 transition-all cursor-pointer"
            >
              ⚡ Coba Demo Kasir (12 Jam)
            </button>
          </div>
        </header>
      )}
      {/* Registration Success Alert Toast */}
      {registerSuccessMsg && (
        <div className="bg-emerald-600 text-white px-5 py-4 rounded-2xl shadow-xl flex items-center justify-between animate-bounce">
          <div className="flex items-center space-x-3">
            <CheckCircle className="w-6 h-6 text-emerald-200 shrink-0" />
            <div>
              <p className="font-extrabold text-sm">{registerSuccessMsg}</p>
              <p className="text-xs text-emerald-100">
                Anda dapat langsung mencoba bertransaksi di halaman Kasir (POS).
              </p>
            </div>
          </div>
          <button
            onClick={() => setRegisterSuccessMsg(null)}
            className="p-1 hover:bg-emerald-700 rounded-lg text-emerald-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Hero Welcome Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-slate-900 text-white p-6 lg:p-10 shadow-2xl border border-slate-800">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-purple-500/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-4xl space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-bold tracking-wide uppercase">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>New Hope Multi-Business POS v2.5</span>
            </div>
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-700">
              <Building2 className="w-3.5 h-3.5 text-blue-400" />
              <span>Satu POS untuk Banyak Bidang Usaha</span>
            </div>
          </div>

          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight leading-tight">
            Satu Aplikasi Kasir Pintar untuk <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-amber-400 via-amber-200 to-amber-500 bg-clip-text text-transparent">
              Kafe, Laundry, Ritel, Carwash & Barbershop
            </span>
          </h1>

          <p className="text-slate-300 text-sm lg:text-base leading-relaxed max-w-2xl font-medium">
            <b>New Hope POS</b> dirancang adaptif untuk berbagai jenis industri bisnis. Apakah Anda mengelola <b>Kedai Kopi & Resto</b>, usaha <b>Laundry Kiloan</b>, <b>Toko Ritel & Minimarket</b>, tempat <b>Cuci Mobil/Motor</b>, hingga <b>Barbershop</b> &mdash; New Hope POS memiliki fitur khusus yang siap membantu operasional harian Anda secara maksimal.
          </p>

          {/* Active Store Indicator */}
          <div className="p-4 bg-slate-800/80 rounded-2xl border border-slate-700/80 flex flex-wrap items-center justify-between gap-3 max-w-2xl">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-amber-500 text-slate-950 rounded-xl font-bold">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                  Toko & Mode Aktif Saat Ini
                </p>
                <p className="text-sm font-black text-white">
                  {settings.storeName || 'New Hope Cafe & Resto'}
                </p>
                <p className="text-xs text-slate-400">
                  Sektor: <span className="text-amber-300 font-bold">{currentActivePreset.name}</span>
                </p>
              </div>
            </div>

            <button
              onClick={() => onOpenRegister?.()}
              className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center space-x-2 cursor-pointer active:scale-95"
            >
              <UserCheck className="w-4 h-4" />
              <span>Daftar / Registrasi Bisnis Baru</span>
            </button>
          </div>

          {/* Quick Primary Actions */}
          <div className="pt-2 flex flex-wrap gap-3">
            <button
              onClick={() => setActiveTab('pos')}
              className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs sm:text-sm rounded-2xl shadow-lg shadow-amber-500/25 transition-all flex items-center space-x-2.5 active:scale-95 cursor-pointer"
            >
              <ShoppingCart className="w-5 h-5 text-slate-950" />
              <span>Buka Mesin Kasir ({settings.storeName})</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => setActiveTab('ai')}
              className="px-5 py-3 bg-purple-600/90 hover:bg-purple-600 text-white font-bold text-xs sm:text-sm rounded-2xl border border-purple-400/30 shadow-md transition-all flex items-center space-x-2 active:scale-95 cursor-pointer"
            >
              <Bot className="w-5 h-5 text-purple-300" />
              <span>Tanya AI Copilot</span>
            </button>

            <button
              onClick={() => setActiveTab('reports')}
              className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs sm:text-sm rounded-2xl border border-slate-700 transition-all flex items-center space-x-2 active:scale-95 cursor-pointer"
            >
              <BarChart3 className="w-5 h-5 text-amber-400" />
              <span>Laporan & Analisis</span>
            </button>
          </div>
        </div>
      </div>

      {/* Live Operational Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Omzet Hari Ini</span>
            <div className="p-2 bg-amber-100 rounded-xl text-amber-800">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900">{formatRupiah(todaySales)}</p>
          <p className="text-xs text-slate-500 font-medium">
            {todayOrders.length} Transaksi Selesai ({todayItemsSold} item)
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Status Shift</span>
            <div className={`p-2 rounded-xl ${shift.status === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
              <Zap className="w-5 h-5" />
            </div>
          </div>
          <p className="text-lg font-black text-slate-900">
            {shift.status === 'OPEN' ? 'Shift Aktif' : 'Shift Ditutup'}
          </p>
          <p className="text-xs text-slate-500 font-medium truncate">
            Kasir: {shift.cashierName} ({formatRupiah(shift.initialCash)})
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Katalog Produk</span>
            <div className="p-2 bg-blue-100 rounded-xl text-blue-800">
              <Layers className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900">
            {products.length} <span className="text-sm font-normal text-slate-500">Item Produk</span>
          </p>
          <p className="text-xs text-slate-500 font-medium">
            {categories.length} Kategori ({settings.storeMode} Mode)
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pelanggan Loyalty</span>
            <div className="p-2 bg-purple-100 rounded-xl text-purple-800">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900">{customers.length} <span className="text-sm font-normal text-slate-500">Member</span></p>
          <p className="text-xs text-slate-500 font-medium">Siap kumpulkan poin rewards</p>
        </div>
      </div>

      {/* Interactive Business Sector Selector Section */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 lg:p-8 space-y-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div className="space-y-1">
            <div className="flex items-center space-x-2 text-amber-600 font-extrabold text-xs uppercase tracking-wider">
              <Building2 className="w-4 h-4" />
              <span>Eksplorasi Skenario Bisnis</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900">
              Pilih & Aktifkan Sektor Bisnis Anda
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 font-medium">
              Klik salah satu kategori bisnis di bawah ini untuk melihat fitur khusus dan menguji coba katalog produk contohnya.
            </p>
          </div>

          <button
            onClick={() => setShowRegisterModal(true)}
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs rounded-2xl shadow-sm transition-all flex items-center space-x-2 cursor-pointer w-fit"
          >
            <UserCheck className="w-4 h-4 text-amber-400" />
            <span>Belum Daftar? Coba Gratis 14 Hari</span>
          </button>
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
                    ? 'border-amber-500 bg-amber-50/60 shadow-md ring-2 ring-amber-500/20'
                    : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {isActiveInStore && (
                  <span className="absolute top-2 right-2 px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-black rounded-md shadow-xs">
                    Aktif
                  </span>
                )}

                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white bg-gradient-to-br ${preset.bgGradient} shadow-xs`}>
                  <IconComp className="w-5 h-5" />
                </div>

                <div>
                  <h4 className="font-extrabold text-sm text-slate-900">{preset.name}</h4>
                  <p className="text-[11px] text-slate-500 font-medium truncate mt-0.5">{preset.categoryTag}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Sector Feature Showcase Box */}
        <div className="bg-slate-900 text-white rounded-3xl p-6 lg:p-8 space-y-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-800">
            <div className="space-y-2 max-w-2xl">
              <div className="flex items-center space-x-2">
                <span className="px-3 py-1 bg-amber-500 text-slate-950 text-xs font-black rounded-full uppercase tracking-wide">
                  {selectedPreviewPreset.badge}
                </span>
                <span className="text-xs text-slate-400 font-medium">Mode System: {selectedPreviewPreset.storeMode}</span>
              </div>
              <h3 className="text-2xl font-black text-white">
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
                <div key={idx} className="bg-slate-800/90 p-4 rounded-2xl border border-slate-700/80 space-y-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-xs">
                    {idx + 1}
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
                    className="w-12 h-12 rounded-xl object-cover shrink-0"
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
      </div>

      {/* Complete POS Features Overview */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 lg:p-8 space-y-6 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-amber-600 font-extrabold text-xs uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4" />
            <span>Modul Sistem Terintegrasi</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900">
            Mengapa Memilih New Hope POS?
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            Satu aplikasi komplit untuk kasir, manajemen tim, hingga analitik bisnis masa depan.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold shadow-xs">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <h3 className="font-extrabold text-base text-slate-900">Fast-Checkout Kasir & Struk</h3>
            <p className="text-xs text-slate-600 leading-relaxed font-medium">
              Proses transaksi cepat dengan pilihan bayar Tunai, QRIS, & Kartu Debit. Cetak nota fisik ke printer thermal 58mm/80mm atau bagikan receipt via WhatsApp.
            </p>
          </div>

          <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center font-bold shadow-xs">
              <Bot className="w-5 h-5" />
            </div>
            <h3 className="font-extrabold text-base text-slate-900">AI Copilot Business Advisor</h3>
            <p className="text-xs text-slate-600 leading-relaxed font-medium">
              Manfaatkan kecerdasan buatan Gemini AI untuk menganalisis jam sibuk toko, produk terlaris, serta memberikan rekomendasi strategi promo menarik.
            </p>
          </div>

          <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold shadow-xs">
              <Users className="w-5 h-5" />
            </div>
            <h3 className="font-extrabold text-base text-slate-900">Hak Akses Karyawan (RBAC + PIN)</h3>
            <p className="text-xs text-slate-600 leading-relaxed font-medium">
              Atur hak akses terpisah untuk Kasir, Manager, dan Owner. Proteksi void transaksi, diskon khusus, dan penyesuaian stok dengan verifikasi PIN 4 digit.
            </p>
          </div>
        </div>
      </div>

      {/* Pricing / Tier Plans */}
      <div className="bg-slate-900 rounded-3xl p-6 lg:p-8 space-y-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="space-y-2 text-center relative z-10">
          <h2 className="text-2xl sm:text-3xl font-black text-white">
            Pilihan Paket <span className="text-amber-400">Langganan</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 font-medium max-w-2xl mx-auto">
            Mulai dari gratis selamanya hingga fitur enterprise multi-outlet. Sesuaikan dengan skala bisnis Anda.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 relative z-10">
          {/* Free Trial */}
          <div className="bg-slate-800/80 rounded-2xl border border-slate-700 p-5 flex flex-col">
            <h3 className="font-extrabold text-lg text-white">Free Trial</h3>
            <p className="text-xs text-amber-400 font-bold mb-4">45 Hari Coba Gratis</p>
            <div className="text-2xl font-black text-white mb-6">Rp 0</div>
            
            <ul className="space-y-3 flex-1 mb-6 text-xs text-slate-300 font-medium">
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>1 Outlet</span></li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>Limit 100 Produk</span></li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>Full Access POS & Dash</span></li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>AI Analyst: 10x Interaksi Total</span></li>
            </ul>
            <button onClick={() => onOpenRegister?.()} className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer">Daftar Sekarang</button>
          </div>

          {/* Free Tier */}
          <div className="bg-slate-800/80 rounded-2xl border border-slate-700 p-5 flex flex-col">
            <h3 className="font-extrabold text-lg text-white">Free Tier</h3>
            <p className="text-xs text-slate-400 mb-4">Gratis Selamanya</p>
            <div className="text-2xl font-black text-white mb-6">Rp 0<span className="text-xs font-normal text-slate-500"> / bln</span></div>
            
            <ul className="space-y-3 flex-1 mb-6 text-xs text-slate-300 font-medium">
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>1 Outlet</span></li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>Limit 30 Produk</span></li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>Basic POS + Daily Sales</span></li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>AI Analyst: 3x / bulan</span></li>
            </ul>
            <button onClick={() => onOpenRegister?.()} className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer">Daftar Sekarang</button>
          </div>

          {/* Tier Plus */}
          <div className="bg-gradient-to-b from-amber-500/10 to-slate-800/80 rounded-2xl border border-amber-500/50 p-5 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-amber-500 text-slate-950 text-[10px] font-black px-3 py-1 rounded-bl-lg">POPULER</div>
            <h3 className="font-extrabold text-lg text-amber-400">Tier Plus</h3>
            <p className="text-xs text-slate-400 mb-4">UMKM & Kedai Menengah</p>
            <div className="mb-6">
              <div className="text-2xl font-black text-white">Rp 99rb<span className="text-xs font-normal text-slate-500"> / bln</span></div>
              <div className="text-[10px] text-slate-400 mt-1">Atau Rp 79rb/bln (Tahunan)</div>
            </div>
            
            <ul className="space-y-3 flex-1 mb-6 text-xs text-slate-300 font-medium">
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" /><span>Up to 2 Outlet (+59rb/cabang/bln)</span></li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" /><span>Limit 100 Produk / outlet</span></li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" /><span>Full POS + Inventory + Analytics</span></li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" /><span>AI Analyst: 30x / bulan</span></li>
            </ul>
            <button onClick={() => onOpenRegister?.()} className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs transition-colors shadow-lg shadow-amber-500/20 cursor-pointer">Mulai Tier Plus</button>
          </div>

          {/* Tier Pro */}
          <div className="bg-slate-800/80 rounded-2xl border border-slate-700 p-5 flex flex-col">
            <h3 className="font-extrabold text-lg text-white">Tier Pro</h3>
            <p className="text-xs text-slate-400 mb-4">Restoran & Multi Cabang</p>
            <div className="mb-6">
              <div className="text-2xl font-black text-white">Rp 299rb<span className="text-xs font-normal text-slate-500"> / bln</span></div>
              <div className="text-[10px] text-slate-400 mt-1">Atau Rp 239rb/bln (Tahunan)</div>
            </div>
            
            <ul className="space-y-3 flex-1 mb-6 text-xs text-slate-300 font-medium">
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>Up to 4 Outlet (+49rb/cabang/bln)</span></li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>Unlimited Produk</span></li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>Full POS + Adv. Stock + Analisa</span></li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /><span>AI Analyst: 90x / bulan</span></li>
            </ul>
            <button onClick={() => onOpenRegister?.()} className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer">Daftar Sekarang</button>
          </div>
        </div>
      </div>

      {/* Store Information Footer */}
      <div className="bg-slate-900 text-slate-300 rounded-3xl p-6 lg:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2 text-center md:text-left">
          <div className="flex items-center justify-center md:justify-start space-x-2 text-amber-400 font-bold text-sm">
            <Store className="w-5 h-5" />
            <span>New Hope Multi-Business POS</span>
          </div>
          <p className="text-xs text-slate-400 max-w-md font-medium">
            Graha Suryamas Blok K no 4 Sidoarjo &bull; Telp: 0812-3456-7890
          </p>
          <p className="text-[11px] text-slate-500">
            Dikelola oleh sistem <b>New Hope POS</b> &bull; Mode: <b>{settings.storeMode}</b> &bull; Hak Cipta &copy; 2026.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setActiveTab('settings')}
            className="p-3 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-2xl border border-slate-700 transition-all cursor-pointer flex items-center space-x-2 text-xs font-bold"
            title="Buka Pengaturan Toko"
          >
            <Settings className="w-5 h-5" />
            <span>Pengaturan Toko</span>
          </button>
        </div>
      </div>
    </div>
  );
};
