import React, { useState, useMemo } from 'react';
import { usePOS } from '../../context/POSContext';
import { formatRupiah } from '../../utils/formatters';
import { BUSINESS_PRESETS, BusinessSector } from '../../data/businessPresets';
import {
  LayoutDashboard,
  ShoppingCart,
  Grid2X2,
  Package,
  Users,
  BarChart3,
  Bot,
  Settings,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Layers,
  Store,
  CheckCircle2,
  Clock,
  ArrowRight,
  ExternalLink,
  ChevronRight,
  Coffee,
  Shirt,
  ShoppingBag,
  Car,
  Scissors,
  DollarSign,
  Receipt,
  UserCheck,
  Building2,
  CreditCard,
  QrCode,
  Banknote,
  ArrowUpRight,
  Flame,
  ShieldCheck,
  Calendar,
  RefreshCw,
  PlusCircle,
} from 'lucide-react';

interface OverviewPageProps {
  onBackToHome?: () => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({ onBackToHome }) => {
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
    staffMembers,
    getActiveAttendance,
    activateBusinessSector,
  } = usePOS();

  const activeSector = settings.businessSector || 'FNB';
  const activePreset = BUSINESS_PRESETS[activeSector] || BUSINESS_PRESETS.FNB;

  const [selectedSector, setSelectedSector] = useState<BusinessSector>(activeSector);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<'TODAY' | '7DAYS' | '30DAYS'>('TODAY');

  // Today & Historical Metrics calculation
  const todayStr = new Date().toISOString().split('T')[0];
  const todayOrders = useMemo(
    () => orders.filter((o) => o.date.startsWith(todayStr) && o.status === 'COMPLETED'),
    [orders, todayStr]
  );

  const todaySales = useMemo(
    () => todayOrders.reduce((sum, o) => sum + o.total, 0),
    [todayOrders]
  );

  const todayItemsSold = useMemo(
    () => todayOrders.reduce((sum, o) => sum + o.items.reduce((iSum, i) => iSum + i.quantity, 0), 0),
    [todayOrders]
  );

  const averageOrderValue = todayOrders.length > 0 ? Math.round(todaySales / todayOrders.length) : 0;

  const lowStockProducts = useMemo(
    () => products.filter((p) => p.stock <= p.minStockAlert),
    [products]
  );

  const occupiedTables = useMemo(
    () => tables.filter((t) => t.status === 'OCCUPIED').length,
    [tables]
  );

  const activeStaffCount = useMemo(
    () => staffMembers.filter((s) => getActiveAttendance(s.id)).length,
    [staffMembers, getActiveAttendance]
  );

  // 7-day Sales Trend Calculation
  const last7DaysData = useMemo(() => {
    const days: { label: string; date: string; sales: number; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split('T')[0];
      const dayLabel = d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' });
      
      const dayOrders = orders.filter(
        (o) => o.date.startsWith(dateKey) && o.status === 'COMPLETED'
      );
      const daySum = dayOrders.reduce((sum, o) => sum + o.total, 0);

      days.push({
        label: dayLabel,
        date: dateKey,
        sales: daySum,
        count: dayOrders.length,
      });
    }
    return days;
  }, [orders]);

  const maxDailySales = useMemo(
    () => Math.max(...last7DaysData.map((d) => d.sales), 100000),
    [last7DaysData]
  );

  // Payment Breakdown
  const paymentBreakdown = useMemo(() => {
    const breakdown: Record<string, { count: number; total: number }> = {
      CASH: { count: 0, total: 0 },
      QRIS: { count: 0, total: 0 },
      DEBIT: { count: 0, total: 0 },
      TRANSFER: { count: 0, total: 0 },
      SHOPEEPAY: { count: 0, total: 0 },
      GOPAY: { count: 0, total: 0 },
      OVO: { count: 0, total: 0 },
    };

    todayOrders.forEach((o) => {
      const method = o.paymentMethod || 'CASH';
      if (!breakdown[method]) {
        breakdown[method] = { count: 0, total: 0 };
      }
      breakdown[method].count += 1;
      breakdown[method].total += o.total;
    });

    return Object.entries(breakdown)
      .filter(([_, data]) => data.count > 0)
      .map(([method, data]) => ({
        method,
        count: data.count,
        total: data.total,
        percentage: todaySales > 0 ? Math.round((data.total / todaySales) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [todayOrders, todaySales]);

  // Top Selling Products Calculation
  const topProducts = useMemo(() => {
    const map: Record<string, { product: (typeof products)[0]; qty: number; revenue: number }> = {};
    orders
      .filter((o) => o.status === 'COMPLETED')
      .forEach((o) => {
        o.items.forEach((item) => {
          if (!map[item.productId]) {
            const found = products.find((p) => p.id === item.productId);
            if (found) {
              map[item.productId] = { product: found, qty: 0, revenue: 0 };
            }
          }
          if (map[item.productId]) {
            map[item.productId].qty += item.quantity;
            map[item.productId].revenue += item.totalPrice;
          }
        });
      });

    return Object.values(map)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 4);
  }, [orders, products]);

  const handleSwitchSector = (sec: BusinessSector) => {
    activateBusinessSector(sec);
    setSelectedSector(sec);
    setSuccessMsg(`Format toko berhasil diubah ke mode "${BUSINESS_PRESETS[sec].name}"!`);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const sectorIcons: Record<BusinessSector, any> = {
    FNB: Coffee,
    LAUNDRY: Shirt,
    RETAIL: ShoppingBag,
    CARWASH: Car,
    BARBERSHOP: Scissors,
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50/70 p-4 lg:p-8 space-y-6 animate-fade-in">
      {/* Toast Alert */}
      {successMsg && (
        <div className="bg-emerald-600 text-white px-5 py-3.5 rounded-2xl shadow-xl flex items-center justify-between animate-bounce">
          <div className="flex items-center space-x-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-200" />
            <p className="font-bold text-sm">{successMsg}</p>
          </div>
        </div>
      )}

      {/* 1. TOP HEADER: STORE PROFILE, SHIFT BAR & QUICK ACTIONS */}
      <div className="relative overflow-hidden rounded-3xl bg-slate-900 text-white p-6 lg:p-8 shadow-2xl border border-slate-800">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3.5">
            {/* Badges Strip */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500 text-slate-950 text-xs font-black uppercase tracking-wider shadow-xs">
                <Store className="w-3.5 h-3.5" />
                <span>{activePreset.name}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/90 text-slate-200 text-xs font-bold border border-slate-700">
                <Building2 className="w-3.5 h-3.5 text-blue-400" />
                <span>{settings.storeName || 'Outlet Utama'}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/90 text-slate-300 text-xs font-semibold border border-slate-700">
                <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Petugas: {currentUser?.name || 'Kasir'} ({currentUser?.role || 'ADMIN'})</span>
              </span>
              {shift.status === 'OPEN' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/40 animate-pulse">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Shift Terbuka (Kas Awal: {formatRupiah(shift.initialCash || 0)})</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 text-xs font-bold border border-rose-500/40">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Shift Ditutup</span>
                </span>
              )}
            </div>

            {/* Title & Welcome */}
            <div>
              <h1 className="text-2xl lg:text-3xl font-black text-white tracking-tight">
                Dashboard & Ringkasan Toko
              </h1>
              <p className="text-xs lg:text-sm text-slate-300 max-w-2xl mt-1 font-medium leading-relaxed">
                Pantau kinerja penjualan kasir secara realtime, pergerakan stok barang, status meja pelanggan, dan analisis kecerdasan buatan AI untuk bisnis Anda.
              </p>
            </div>
          </div>

          {/* Quick Launch Buttons */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              onClick={() => setActiveTab('pos')}
              className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/25 transition-all flex items-center gap-2.5 active:scale-95 cursor-pointer"
            >
              <ShoppingCart className="w-5 h-5 text-slate-950" />
              <span>Buka Mesin Kasir (POS)</span>
              <ArrowRight className="w-4 h-4 text-slate-950" />
            </button>

            <button
              onClick={() => setActiveTab('ai')}
              className="px-4 py-3.5 rounded-2xl bg-purple-600/80 hover:bg-purple-600 border border-purple-400/30 text-white font-bold text-xs transition-all flex items-center gap-2 active:scale-95 cursor-pointer shadow-md"
            >
              <Bot className="w-4 h-4 text-purple-300" />
              <span>AI Copilot</span>
            </button>

            {onBackToHome && (
              <button
                onClick={onBackToHome}
                className="px-4 py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer"
                title="Kembali ke Landing Page Beranda"
              >
                <span>Halaman Depan</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. REALTIME CORE KPI CARDS GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Omzet Hari Ini */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs space-y-3 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Omzet Hari Ini</span>
            <div className="p-2.5 rounded-2xl bg-amber-50 text-amber-600 border border-amber-100">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div>
            <p className="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">{formatRupiah(todaySales)}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="inline-flex items-center text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>{todayOrders.length} Pesanan</span>
              </span>
              <span className="text-xs text-slate-400">selesai hari ini</span>
            </div>
          </div>
        </div>

        {/* Rata-Rata Transaksi (AOV) & Total Qty */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs space-y-3 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Rata-Rata Struk</span>
            <div className="p-2.5 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100">
              <Package className="w-5 h-5" />
            </div>
          </div>
          <div>
            <p className="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">{formatRupiah(averageOrderValue)}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="inline-flex items-center text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                {todayItemsSold} Item
              </span>
              <span className="text-xs text-slate-400">terjual keluar toko</span>
            </div>
          </div>
        </div>

        {/* Meja / Slot Operasional */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs space-y-3 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">
              {activePreset.layoutTerm?.tabLabel || 'Denah Layout'} Terisi
            </span>
            <div className="p-2.5 rounded-2xl bg-purple-50 text-purple-600 border border-purple-100">
              <Grid2X2 className="w-5 h-5" />
            </div>
          </div>
          <div>
            <p className="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">
              {occupiedTables} <span className="text-sm text-slate-400 font-semibold">/ {tables.length} {activePreset.layoutTerm?.itemNoun || 'Meja'}</span>
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="inline-flex items-center text-xs font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-md">
                {tables.length > 0 ? Math.round((occupiedTables / tables.length) * 100) : 0}% Kapasitas
              </span>
              <span className="text-xs text-slate-400">sedang digunakan</span>
            </div>
          </div>
        </div>

        {/* Status Stok & Peringatan */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs space-y-3 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Alert Stok Kritis</span>
            <div className={`p-2.5 rounded-2xl border ${lowStockProducts.length > 0 ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
          <div>
            <p className="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">
              {lowStockProducts.length} <span className="text-sm text-slate-400 font-semibold">Produk</span>
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-md ${lowStockProducts.length > 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                {lowStockProducts.length > 0 ? 'Segera Restok' : 'Aman'}
              </span>
              <span className="text-xs text-slate-400">dari {products.length} item</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. CHARTS & VISUAL ANALYTICS (7-DAY SALES & PAYMENT SHARE) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 7-Day Trend Interactive Chart */}
        <div className="lg:col-span-2 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
            <div>
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-amber-500" />
                <span>Tren Penjualan 7 Hari Terakhir</span>
              </h2>
              <p className="text-xs text-slate-500">Performa transaksi dan omzet harian outlet Anda</p>
            </div>
            <span className="text-xs font-extrabold text-amber-600 bg-amber-50 px-3 py-1 rounded-xl border border-amber-100">
              Total 7 Hari: {formatRupiah(last7DaysData.reduce((s, d) => s + d.sales, 0))}
            </span>
          </div>

          {/* Bar Chart Visualization */}
          <div className="pt-4 flex items-end justify-between gap-2 h-52 px-2">
            {last7DaysData.map((d, idx) => {
              const heightPercent = Math.max(Math.round((d.sales / maxDailySales) * 100), 8);
              const isToday = idx === last7DaysData.length - 1;

              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end">
                  {/* Tooltip on hover */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-bold py-1 px-2 rounded-lg pointer-events-none mb-1 text-center whitespace-nowrap shadow-lg z-20">
                    <p>{d.label}</p>
                    <p className="text-amber-300">{formatRupiah(d.sales)}</p>
                    <p className="text-slate-400">{d.count} Transaksi</p>
                  </div>

                  {/* Bar */}
                  <div className="w-full max-w-[48px] bg-slate-100 rounded-2xl overflow-hidden flex flex-col justify-end p-1 h-36">
                    <div
                      style={{ height: `${heightPercent}%` }}
                      className={`w-full rounded-xl transition-all duration-500 ${
                        isToday
                          ? 'bg-gradient-to-t from-amber-500 to-amber-400 shadow-md shadow-amber-500/20'
                          : 'bg-gradient-to-t from-slate-400 to-slate-300 group-hover:from-amber-400 group-hover:to-amber-300'
                      }`}
                    />
                  </div>

                  {/* Day Label */}
                  <span className={`text-[11px] font-bold ${isToday ? 'text-amber-600 font-black' : 'text-slate-500'}`}>
                    {d.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Payment Method Distribution */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-blue-500" />
              <span>Metode Pembayaran</span>
            </h2>
            <p className="text-xs text-slate-500">Distribusi cara bayar pelanggan hari ini</p>
          </div>

          <div className="space-y-3 py-2">
            {paymentBreakdown.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                Belum ada data pembayaran hari ini.
              </div>
            ) : (
              paymentBreakdown.map((item) => (
                <div key={item.method} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-700 flex items-center gap-1.5">
                      {item.method === 'CASH' && <Banknote className="w-4 h-4 text-emerald-600" />}
                      {item.method === 'QRIS' && <QrCode className="w-4 h-4 text-purple-600" />}
                      {item.method !== 'CASH' && item.method !== 'QRIS' && <CreditCard className="w-4 h-4 text-blue-600" />}
                      <span>{item.method}</span>
                    </span>
                    <span className="text-slate-900 font-extrabold">{formatRupiah(item.total)} ({item.percentage}%)</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${item.percentage}%` }}
                      className={`h-full rounded-full ${
                        item.method === 'QRIS'
                          ? 'bg-purple-500'
                          : item.method === 'CASH'
                          ? 'bg-emerald-500'
                          : 'bg-blue-500'
                      }`}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          <button
            onClick={() => setActiveTab('reports')}
            className="w-full py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-extrabold text-xs transition-all flex items-center justify-center gap-1.5"
          >
            <span>Lihat Rekap Kas & Laporan Lengkap</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 4. SECTOR SWITCHER & TOP SELLING PRODUCTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sektor Mode Switcher (5 Business Presets) */}
        <div className="lg:col-span-2 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-500" />
                <span>Pilih Mode Format Bisnis Toko</span>
              </h2>
              <p className="text-xs text-slate-500">Sesuaikan katalog, tata letak, dan alur kerja sesuai bidang usaha:</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {(Object.keys(BUSINESS_PRESETS) as BusinessSector[]).map((sec) => {
              const preset = BUSINESS_PRESETS[sec];
              const Icon = sectorIcons[sec];
              const isCurrent = activeSector === sec;

              return (
                <button
                  key={sec}
                  onClick={() => handleSwitchSector(sec)}
                  className={`p-4 rounded-2xl border text-left transition-all relative flex flex-col justify-between space-y-3 cursor-pointer ${
                    isCurrent
                      ? 'border-amber-500 bg-amber-50/70 shadow-md ring-2 ring-amber-500/20'
                      : 'border-slate-200 bg-slate-50/60 hover:bg-slate-100 hover:border-slate-300'
                  }`}
                >
                  {isCurrent && (
                    <span className="absolute top-2 right-2 px-1.5 py-0.5 bg-amber-500 text-slate-950 text-[9px] font-black rounded-md">
                      Aktif
                    </span>
                  )}
                  <div className={`p-2.5 rounded-xl w-fit ${isCurrent ? 'bg-amber-500 text-slate-950' : 'bg-slate-200/80 text-slate-700'}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-black text-xs text-slate-900 leading-tight">{preset.name.split('&')[0]}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{preset.layoutTerm?.itemNoun || 'Item'}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active Preset Feature Highlights */}
          <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                Fitur Spesifik Mode {activePreset.name}:
              </span>
              <span className="text-[11px] text-slate-400 font-medium">{activePreset.products.length} produk katalog bawaan</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-300">
              {activePreset.features.map((feat, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>{feat.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top Selling Products List */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Flame className="w-5 h-5 text-amber-500" />
              <span>Produk Terlaris</span>
            </h2>
            <span className="text-[10px] font-bold text-slate-400 uppercase">Top Sales</span>
          </div>

          <div className="space-y-3">
            {topProducts.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                Belum ada data penjualan produk.
              </div>
            ) : (
              topProducts.map((item, idx) => (
                <div key={item.product.id} className="flex items-center gap-3 p-2.5 rounded-2xl bg-slate-50 hover:bg-slate-100/80 transition-colors">
                  <span className="w-6 h-6 rounded-xl bg-amber-100 text-amber-900 font-black text-xs flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <img
                    src={item.product.image}
                    alt={item.product.name}
                    className="w-10 h-10 rounded-xl object-cover shrink-0 border border-slate-200"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold text-xs text-slate-900 truncate">{item.product.name}</p>
                    <p className="text-[11px] text-slate-500 font-semibold">{formatRupiah(item.product.price)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-black text-xs text-amber-600">{item.qty} terjual</p>
                    <p className="text-[10px] text-slate-400">{formatRupiah(item.revenue)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 5. AI COPILOT SMART ADVISOR & LIVE RECENT TRANSACTIONS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* AI Copilot Card */}
        <div className="bg-gradient-to-br from-purple-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 border border-purple-700/40 shadow-xl space-y-4 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/15 rounded-full blur-3xl pointer-events-none" />

          <div className="space-y-3 relative z-10">
            <div className="flex items-center space-x-2">
              <div className="p-2 bg-purple-500 text-white rounded-xl">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-base text-white">New Hope AI Copilot</h3>
                <p className="text-[11px] text-purple-300">Asisten Pintar Bisnis Anda</p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white/10 backdrop-blur-md border border-white/10 text-xs text-purple-100 space-y-2 leading-relaxed font-medium">
              <p className="font-bold text-amber-300 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" />
                <span>Insight Operasional Hari Ini:</span>
              </p>
              <p>
                {todayOrders.length > 5
                  ? `Volume transaksi hari ini mencapai ${todayOrders.length} pesanan dengan omzet ${formatRupiah(todaySales)}. Produk kategori "${activePreset.name.split('&')[0]}" mendominasi 70% penjualan!`
                  : `Toko dalam mode "${activePreset.name}". Pastikan kasir mengaktifkan shift kas dan memeriksa stok bahan baku sebelum jam sibuk!`}
              </p>
            </div>
          </div>

          <button
            onClick={() => setActiveTab('ai')}
            className="w-full py-3 rounded-2xl bg-white hover:bg-purple-50 text-slate-950 font-black text-xs transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-95 relative z-10"
          >
            <Sparkles className="w-4 h-4 text-purple-700" />
            <span>Buka Obrolan AI Copilot ➔</span>
          </button>
        </div>

        {/* Live Recent Transactions Feed */}
        <div className="lg:col-span-2 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Receipt className="w-5 h-5 text-slate-700" />
              <span>Transaksi Terkini Kasir ({orders.length})</span>
            </h2>
            <button
              onClick={() => setActiveTab('reports')}
              className="text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1 cursor-pointer"
            >
              <span>Lihat Semua di Laporan</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {orders.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              Belum ada riwayat transaksi hari ini. Buka Kasir untuk melakukan penjualan pertama!
            </div>
          ) : (
            <div className="divide-y divide-slate-100 overflow-x-auto">
              {orders.slice(0, 5).map((order) => (
                <div key={order.id} className="py-3.5 flex items-center justify-between gap-4 text-xs hover:bg-slate-50/80 px-2 rounded-xl transition-colors">
                  <div className="space-y-0.5">
                    <p className="font-mono font-bold text-slate-900">{order.id.slice(0, 16).toUpperCase()}</p>
                    <p className="text-slate-500 text-[11px]">
                      {new Date(order.date).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} • {order.items.length} item • Kasir: {order.cashierName}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-slate-900 text-sm">{formatRupiah(order.total)}</p>
                    <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${
                      order.paymentMethod === 'QRIS' ? 'bg-purple-100 text-purple-800' : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {order.paymentMethod}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OverviewPage;
