import React, { useState } from 'react';
import {
  Store,
  Coffee,
  ShoppingBag,
  Shirt,
  Scissors,
  Car,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Zap,
  TrendingUp,
  ShieldCheck,
  Smartphone,
  Layers,
  BarChart3,
  Bot,
  Grid2X2,
  Users,
  Check,
  ChevronRight,
  Star,
  Play,
  Lock,
} from 'lucide-react';
import { BUSINESS_PRESETS, BusinessSector } from '../../data/businessPresets';
import { formatRupiah } from '../../utils/formatters';

interface LandingPageProps {
  onStartDemo: () => void;
  onOpenLogin: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onStartDemo,
  onOpenLogin,
}) => {
  const [activeSector, setActiveSector] = useState<BusinessSector>('FNB');

  const sectorList: { id: BusinessSector; label: string; icon: React.ReactNode; desc: string }[] = [
    {
      id: 'FNB',
      label: 'Resto & Kafe',
      icon: <Coffee className="w-4 h-4" />,
      desc: 'Manajemen meja visual, kitchen order ticket (KOT), split bill, dan varian pesanan.',
    },
    {
      id: 'RETAIL',
      label: 'Toko Ritel & Mart',
      icon: <ShoppingBag className="w-4 h-4" />,
      desc: 'Barcode scanner cepat, pelacakan stok SKU, diskon grosir, dan notifikasi stok habis.',
    },
    {
      id: 'LAUNDRY',
      label: 'Laundry Kiloan',
      icon: <Shirt className="w-4 h-4" />,
      desc: 'Pelacakan status cuci-kering-setrika, kalkulasi berat timbangan, dan nomor rak pengambilan.',
    },
    {
      id: 'BARBERSHOP',
      label: 'Barbershop & Salon',
      icon: <Scissors className="w-4 h-4" />,
      desc: 'Pilihan kapster/stylist, antrean kursi potong, bagi hasil komisi staf, dan paket treatment.',
    },
    {
      id: 'CARWASH',
      label: 'Carwash & Detailing',
      icon: <Car className="w-4 h-4" />,
      desc: 'Manajemen antrean bay cuci mobil/motor, paket hidrolik + poles, dan performa tim pencuci.',
    },
  ];

  const currentPreset = BUSINESS_PRESETS[activeSector];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-amber-500 selection:text-slate-950 font-sans overflow-x-hidden">
      {/* Top Floating Glow Lights */}
      <div className="fixed top-0 left-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="fixed top-1/3 right-1/4 w-[500px] h-[500px] bg-orange-600/10 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="fixed bottom-10 left-1/3 w-[600px] h-[600px] bg-indigo-600/5 rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Navigation Bar */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-slate-950/80 border-b border-slate-800/80 px-4 sm:px-8 py-3.5 transition-all">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Brand Logo */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/25">
              <Store className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-extrabold text-lg text-white tracking-tight block leading-tight">
                New Hope <span className="text-amber-400">POS</span>
              </span>
              <span className="text-[10px] font-bold text-amber-500/90 tracking-wider uppercase">
                Cloud Kasir Multi-Sektor
              </span>
            </div>
          </div>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center space-x-8 text-xs font-semibold text-slate-300">
            <a href="#fitur" className="hover:text-amber-400 transition-colors">Fitur Utama</a>
            <a href="#sektor" className="hover:text-amber-400 transition-colors">Multi-Sektor</a>
            <a href="#ai-copilot" className="hover:text-amber-400 transition-colors">AI Copilot</a>
            <a href="#harga" className="hover:text-amber-400 transition-colors">Paket Harga</a>
          </nav>

          {/* Action CTAs */}
          <div className="flex items-center space-x-3">
            <button
              onClick={onOpenLogin}
              className="px-4 py-2 text-xs font-bold text-slate-200 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-xl transition-all"
            >
              Masuk Akun
            </button>
            <button
              onClick={onStartDemo}
              className="flex items-center space-x-1.5 px-4 py-2 text-xs font-extrabold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-xl shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 active:scale-95 transition-all"
            >
              <Zap className="w-3.5 h-3.5 fill-slate-950" />
              <span>Coba Demo Gratis</span>
            </button>
          </div>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="relative pt-12 sm:pt-20 pb-16 sm:pb-24 px-4 sm:px-6 max-w-7xl mx-auto text-center">
        {/* Modern Pill Badge */}
        <div className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold mb-6 animate-fade-in shadow-inner">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Point of Sale Cerdas Generasi Baru dengan AI Copilot</span>
        </div>

        {/* Hero Title */}
        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight max-w-4xl mx-auto leading-[1.15] mb-6">
          Kelola Kasir, Stok & Cabang Bisnis Jadi{' '}
          <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 bg-clip-text text-transparent">
            Otomatis & Realtime
          </span>
        </h1>

        {/* Hero Subtitle */}
        <p className="text-slate-300 text-sm sm:text-base lg:text-lg max-w-2xl mx-auto leading-relaxed mb-8">
          Sistem kasir pintar untuk <b>Resto & Kafe, Ritel, Laundry, Barbershop, hingga Carwash</b>.
          Lengkap dengan AI prediksi omzet, manajemen meja, kontrol stok bahan baku, dan mode offline.
        </p>

        {/* Primary Hero CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 max-w-md mx-auto mb-10">
          <button
            onClick={onStartDemo}
            className="w-full sm:w-auto flex-1 flex items-center justify-center space-x-2 py-3.5 px-6 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-sm rounded-2xl shadow-xl shadow-amber-500/25 active:scale-98 transition-all"
          >
            <Play className="w-4 h-4 fill-slate-950" />
            <span>Mulai Coba Demo Kasir</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <button
            onClick={onOpenLogin}
            className="w-full sm:w-auto flex-1 flex items-center justify-center space-x-2 py-3.5 px-6 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-bold text-sm rounded-2xl transition-all"
          >
            <Lock className="w-4 h-4 text-amber-400" />
            <span>Masuk Akun Kasir</span>
          </button>
        </div>

        {/* Key Trust Highlights */}
        <div className="flex flex-wrap items-center justify-center gap-y-2 gap-x-6 text-xs text-slate-400 font-medium">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Tanpa Kartu Kredit
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Support HP Android & iPhone
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Cloud Database Supabase
          </span>
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Bekerja Saat Internet Putus
          </span>
        </div>
      </section>

      {/* INTERACTIVE MULTI-SECTOR SHOWCASE */}
      <section id="sektor" className="py-16 px-4 sm:px-6 max-w-7xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-3">
            Didesain Khusus untuk 5 Sektor Bisnis
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Pilih sektor usaha Anda untuk melihat tata letak, istilah, dan fitur spesifik yang otomatis disesuaikan.
          </p>
        </div>

        {/* Sector Tabs */}
        <div className="flex items-center justify-start sm:justify-center gap-2 overflow-x-auto pb-4 mb-8 scrollbar-none">
          {sectorList.map((s) => {
            const isSelected = activeSector === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setActiveSector(s.id)}
                className={`flex items-center space-x-2 px-4 py-2.5 rounded-2xl text-xs font-bold whitespace-nowrap transition-all ${
                  isSelected
                    ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 ring-2 ring-amber-400'
                    : 'bg-slate-900/90 text-slate-400 hover:text-white border border-slate-800 hover:border-slate-700'
                }`}
              >
                {s.icon}
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Sector Interactive Showcase Card */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            {/* Left Content */}
            <div className="lg:col-span-6 space-y-5">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-bold">
                <Store className="w-3.5 h-3.5" />
                <span>Preset: {currentPreset.name}</span>
              </div>

              <h3 className="text-xl sm:text-2xl font-black text-white">
                {currentPreset.tagline}
              </h3>

              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {currentPreset.description}
              </p>

              {/* Sector Features Checkmarks */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {currentPreset.products.slice(0, 4).map((p, idx) => (
                  <div key={idx} className="flex items-center space-x-2.5 bg-slate-950/60 border border-slate-800/80 p-2.5 rounded-xl text-xs text-slate-200">
                    <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="truncate">{p.name} ({formatRupiah(p.price)})</span>
                  </div>
                ))}
              </div>

              <div className="pt-3">
                <button
                  onClick={onStartDemo}
                  className="flex items-center space-x-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all"
                >
                  <span>Coba Preset {currentPreset.name} di Kasir</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Right Interactive Mockup / Metric Preview */}
            <div className="lg:col-span-6 bg-slate-950/80 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-rose-500/80" />
                  <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  New Hope POS • {currentPreset.storeMode} Mode
                </span>
              </div>

              {/* Sample Product Grid in Mockup */}
              <div className="grid grid-cols-2 gap-3">
                {currentPreset.products.slice(0, 4).map((p, idx) => (
                  <div key={idx} className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl flex items-center space-x-3">
                    <img
                      src={p.image}
                      alt={p.name}
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-lg object-cover bg-slate-800 shrink-0"
                    />
                    <div className="min-w-0">
                      <h4 className="font-bold text-xs text-white truncate">{p.name}</h4>
                      <p className="text-[11px] font-semibold text-amber-400">{formatRupiah(p.price)}</p>
                      <span className="text-[9px] text-slate-400 block">Stok: {p.stock} {p.unit}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Slot / Table Layout Preview */}
              <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 text-xs">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-2">
                  Format {currentPreset.layoutTerm.itemNoun}:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {currentPreset.tables.slice(0, 5).map((t, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-lg font-mono text-[10px] font-bold"
                    >
                      {t.name} (Zona {t.zone})
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CORE FEATURES GRID */}
      <section id="fitur" className="py-16 px-4 sm:px-6 max-w-7xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-bold mb-3 border border-amber-500/20">
            <Zap className="w-3.5 h-3.5 fill-amber-400" />
            <span>Fitur Komprehensif</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Semua yang Dibutuhkan Kasir Modern
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-2">
            Dari input pesanan secepat kilat hingga rekonsiliasi keuangan otomatis setiap akhir shift.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Feature 1 */}
          <div className="bg-slate-900/60 border border-slate-800 hover:border-amber-500/40 p-6 rounded-3xl transition-all group">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Zap className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">Transaksi Cepat & Split Bill</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Dukungan QRIS, Debit, Tunai (hitung kembalian otomatis), split bill antar pelanggan, dan pending order.
            </p>
          </div>

          {/* Feature 2 */}
          <div id="ai-copilot" className="bg-slate-900/60 border border-slate-800 hover:border-amber-500/40 p-6 rounded-3xl transition-all group relative overflow-hidden">
            <div className="absolute top-3 right-3 px-2 py-0.5 bg-gradient-to-r from-purple-500 to-indigo-500 text-white rounded-full text-[9px] font-bold">
              AI Powered
            </div>
            <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Bot className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">New Hope AI Copilot</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Analisis tren jam sibuk, rekomendasi stok bahan baku, prediksi omzet esok hari, dan ringkasan eksekutif instan.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="bg-slate-900/60 border border-slate-800 hover:border-amber-500/40 p-6 rounded-3xl transition-all group">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Grid2X2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">Denah & Manajemen Meja</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Visualisasi status meja (kosong/terisi/billing), pindah meja, gabung meja, dan timer durasi makan.
            </p>
          </div>

          {/* Feature 4 */}
          <div className="bg-slate-900/60 border border-slate-800 hover:border-amber-500/40 p-6 rounded-3xl transition-all group">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">Inventori & Peringatan Stok</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Perhitungan HPP otomatis, notifikasi stok menipis (*low stock badge*), kartu stok, dan manajemen varian menu.
            </p>
          </div>

          {/* Feature 5 */}
          <div className="bg-slate-900/60 border border-slate-800 hover:border-amber-500/40 p-6 rounded-3xl transition-all group">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">Hak Akses & PIN Otorisasi</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Role Kasir, Supervisor, Manager, dan Admin. Override PIN untuk void transaksi dan diskon khusus.
            </p>
          </div>

          {/* Feature 6 */}
          <div className="bg-slate-900/60 border border-slate-800 hover:border-amber-500/40 p-6 rounded-3xl transition-all group">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Smartphone className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">Responsive HP, Tablet & PC</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Bilah navigasi bawah & keranjang melayang (*drawer sheet*) untuk smartphone Android & iPhone iOS.
            </p>
          </div>
        </div>
      </section>

      {/* PRICING SECTION */}
      <section id="harga" className="py-16 px-4 sm:px-6 max-w-7xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-2">
            Pilihan Paket Transparan
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Mulai dari gratis untuk eksplorasi tanpa batasan waktu.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {/* Plan 1 */}
          <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-3xl flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Starter Demo</span>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-black text-white">Rp 0</span>
                <span className="text-xs text-slate-500">/ selamanya</span>
              </div>
              <p className="text-xs text-slate-400 mb-6">Cocok untuk mencoba seluruh fitur kasir dan simulasi bisnis.</p>
              <ul className="text-xs text-slate-300 space-y-2.5 mb-6">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Akses 5 Preset Sektor Bisnis</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Transaksi Tanpa Batas</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Simulator Barcode & Denah</li>
              </ul>
            </div>
            <button
              onClick={onStartDemo}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition-all"
            >
              Coba Sekarang
            </button>
          </div>

          {/* Plan 2: Pro */}
          <div className="bg-gradient-to-b from-amber-500/10 to-slate-900/90 border-2 border-amber-500 p-6 rounded-3xl flex flex-col justify-between relative shadow-xl shadow-amber-500/10">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-amber-500 text-slate-950 font-black text-[10px] rounded-full uppercase tracking-wider">
              Paling Populer
            </div>
            <div>
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider block mb-1">Pro Outlet</span>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-black text-white">Rp 99.000</span>
                <span className="text-xs text-slate-400">/ bulan</span>
              </div>
              <p className="text-xs text-slate-300 mb-6">Untuk toko ritel, kafe, atau outlet aktif dengan sinkronisasi cloud.</p>
              <ul className="text-xs text-slate-200 space-y-2.5 mb-6">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-amber-400" /> Database Cloud Supabase Dedicated</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-amber-400" /> Multi-Kasir & Staff RBAC</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-amber-400" /> Cetak Struk Bluetooth & PDF</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-amber-400" /> Laporan Laba Kotor & Ekspor Excel</li>
              </ul>
            </div>
            <button
              onClick={onOpenLogin}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded-xl shadow-md transition-all"
            >
              Mulai 14 Hari Trial
            </button>
          </div>

          {/* Plan 3: Enterprise */}
          <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-3xl flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold text-purple-400 uppercase tracking-wider block mb-1">Enterprise AI</span>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-black text-white">Rp 249.000</span>
                <span className="text-xs text-slate-500">/ bulan</span>
              </div>
              <p className="text-xs text-slate-400 mb-6">Untuk jaringan multi-cabang dengan asisten AI Copilot mandiri.</p>
              <ul className="text-xs text-slate-300 space-y-2.5 mb-6">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-purple-400" /> New Hope AI Business Copilot</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-purple-400" /> Multi-Cabang / Multi-Outlet</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-purple-400" /> Transfer Stok Antar Cabang</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-purple-400" /> Prioritas Support 24/7</li>
              </ul>
            </div>
            <button
              onClick={onOpenLogin}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition-all"
            >
              Hubungi Sales
            </button>
          </div>
        </div>
      </section>

      {/* FINAL CTA BANNER */}
      <section className="py-16 px-4 sm:px-6 max-w-5xl mx-auto">
        <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 rounded-3xl p-8 sm:p-12 text-center text-slate-950 shadow-2xl relative overflow-hidden">
          <div className="relative z-10 max-w-2xl mx-auto space-y-5">
            <h2 className="text-2xl sm:text-4xl font-black tracking-tight">
              Siap Meningkatkan Omzet & Efisiensi Toko Anda?
            </h2>
            <p className="text-xs sm:text-sm font-semibold text-slate-900/90 leading-relaxed">
              Coba aplikasi kasir sekarang juga secara langsung di browser tanpa perlu registrasi rumit.
            </p>
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={onStartDemo}
                className="w-full sm:w-auto px-8 py-3.5 bg-slate-950 hover:bg-slate-900 text-amber-400 font-extrabold text-sm rounded-2xl shadow-xl active:scale-95 transition-all"
              >
                Buka Aplikasi Kasir Sekarang ➔
              </button>
              <button
                onClick={onOpenLogin}
                className="w-full sm:w-auto px-6 py-3.5 bg-white/20 hover:bg-white/30 text-slate-950 font-extrabold text-sm rounded-2xl transition-all"
              >
                Masuk ke Akun
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-slate-800/80 py-8 px-4 sm:px-6 text-center text-xs text-slate-500">
        <p>© {new Date().getFullYear()} New Hope POS · Cloud Point of Sale System · All rights reserved.</p>
      </footer>
    </div>
  );
};
