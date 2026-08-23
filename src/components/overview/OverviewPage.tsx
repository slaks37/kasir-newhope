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
  Percent,
  Coins,
  Wallet,
  TrendingDown,
  PieChart as PieChartIcon,
  HelpCircle,
  CheckCircle,
  Star,
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

  // Filtered Orders based on Time Range
  const filteredOrders = useMemo(() => {
    const now = new Date();
    return orders.filter((o) => {
      if (o.status !== 'COMPLETED') return false;
      const oDate = new Date(o.date);
      if (timeFilter === 'TODAY') {
        return oDate.toDateString() === now.toDateString();
      }
      if (timeFilter === '7DAYS') {
        const past7 = new Date();
        past7.setDate(past7.getDate() - 7);
        return oDate >= past7;
      }
      if (timeFilter === '30DAYS') {
        const past30 = new Date();
        past30.setDate(past30.getDate() - 30);
        return oDate >= past30;
      }
      return true;
    });
  }, [orders, timeFilter]);

  const timeFilterLabel = useMemo(() => {
    if (timeFilter === 'TODAY') return 'Hari Ini';
    if (timeFilter === '7DAYS') return '7 Hari Terakhir';
    return '30 Hari Terakhir';
  }, [timeFilter]);

  // Comprehensive Financial & Unit Economics Calculations
  const financialMetrics = useMemo(() => {
    let grossSales = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    let serviceChargeTotal = 0;
    let netRevenue = 0;
    let totalCOGS = 0; // Modal Bahan Baku / HPP
    let itemsSold = 0;
    let cashSales = 0;
    let cashCount = 0;
    let cashlessSales = 0;
    let cashlessCount = 0;

    const methodMap: Record<string, { name: string; count: number; total: number }> = {
      QRIS: { name: 'QRIS', count: 0, total: 0 },
      CASH: { name: 'Tunai', count: 0, total: 0 },
      DEBIT: { name: 'Kartu Debit', count: 0, total: 0 },
      TRANSFER: { name: 'Transfer Bank', count: 0, total: 0 },
      SHOPEEPAY: { name: 'ShopeePay', count: 0, total: 0 },
      GOPAY: { name: 'GoPay', count: 0, total: 0 },
      OVO: { name: 'OVO', count: 0, total: 0 },
    };

    filteredOrders.forEach((o) => {
      netRevenue += o.total || 0;
      grossSales += (o.subtotal || o.total) + (o.discountTotal || 0);
      discountTotal += o.discountTotal || 0;
      taxTotal += o.taxTotal || 0;
      serviceChargeTotal += o.serviceChargeTotal || 0;

      const m = o.paymentMethod || 'CASH';
      if (!methodMap[m]) {
        methodMap[m] = { name: m, count: 0, total: 0 };
      }
      methodMap[m].count += 1;
      methodMap[m].total += o.total;

      if (m === 'CASH') {
        cashSales += o.total;
        cashCount += 1;
      } else {
        cashlessSales += o.total;
        cashlessCount += 1;
      }

      o.items.forEach((item) => {
        itemsSold += item.quantity;
        const prod = products.find((p) => p.id === item.productId);
        const unitCost = prod ? prod.costPrice : item.unitPrice * 0.45;
        totalCOGS += unitCost * item.quantity;
      });
    });

    const grossProfit = Math.max(0, netRevenue - totalCOGS - taxTotal);
    const netProfitMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
    const averageOrderValue = filteredOrders.length > 0 ? Math.round(netRevenue / filteredOrders.length) : 0;

    const cashPercent = netRevenue > 0 ? Math.round((cashSales / netRevenue) * 100) : 0;
    const cashlessPercent = netRevenue > 0 ? Math.round((cashlessSales / netRevenue) * 100) : 0;

    const sortedMethods = Object.entries(methodMap)
      .filter(([_, data]) => data.count > 0)
      .map(([key, data]) => ({
        key,
        name: data.name,
        count: data.count,
        total: data.total,
        percentage: netRevenue > 0 ? Math.round((data.total / netRevenue) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    const mostUsedMethod = sortedMethods.length > 0 ? sortedMethods[0] : null;

    return {
      grossSales,
      discountTotal,
      taxTotal,
      serviceChargeTotal,
      netRevenue,
      totalCOGS,
      grossProfit,
      netProfitMargin: Math.round(netProfitMargin * 10) / 10,
      averageOrderValue,
      itemsSold,
      cashSales,
      cashCount,
      cashPercent,
      cashlessSales,
      cashlessCount,
      cashlessPercent,
      sortedMethods,
      mostUsedMethod,
      orderCount: filteredOrders.length,
    };
  }, [filteredOrders, products]);

  const lowStockProducts = useMemo(
    () => products.filter((p) => p.stock <= p.minStockAlert),
    [products]
  );

  const occupiedTables = useMemo(
    () => tables.filter((t) => t.status === 'OCCUPIED').length,
    [tables]
  );

  // 7-day Sales Trend Calculation
  const last7DaysData = useMemo(() => {
    const days: { label: string; date: string; sales: number; profit: number; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split('T')[0];
      const dayLabel = d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' });

      const dayOrders = orders.filter(
        (o) => o.date.startsWith(dateKey) && o.status === 'COMPLETED'
      );
      const daySales = dayOrders.reduce((sum, o) => sum + o.total, 0);

      let dayCost = 0;
      dayOrders.forEach((o) => {
        o.items.forEach((item) => {
          const prod = products.find((p) => p.id === item.productId);
          dayCost += (prod ? prod.costPrice : item.unitPrice * 0.45) * item.quantity;
        });
      });

      days.push({
        label: dayLabel,
        date: dateKey,
        sales: daySales,
        profit: Math.max(0, daySales - dayCost),
        count: dayOrders.length,
      });
    }
    return days;
  }, [orders, products]);

  const maxDailySales = useMemo(
    () => Math.max(...last7DaysData.map((d) => d.sales), 100000),
    [last7DaysData]
  );

  // Top Selling Products with Margin
  const topProducts = useMemo(() => {
    const map: Record<string, { product: (typeof products)[0]; qty: number; revenue: number; profit: number }> = {};
    filteredOrders.forEach((o) => {
      o.items.forEach((item) => {
        if (!map[item.productId]) {
          const found = products.find((p) => p.id === item.productId);
          if (found) {
            map[item.productId] = { product: found, qty: 0, revenue: 0, profit: 0 };
          }
        }
        if (map[item.productId]) {
          const unitCost = map[item.productId].product.costPrice || map[item.productId].product.price * 0.45;
          map[item.productId].qty += item.quantity;
          map[item.productId].revenue += item.totalPrice;
          map[item.productId].profit += item.totalPrice - unitCost * item.quantity;
        }
      });
    });

    return Object.values(map)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 4);
  }, [filteredOrders, products]);

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

  // Nama orang yang benar-benar masuk, atau tanda hubung. Nilai cadangan
  // 'Budi Santoso' membuat layar tampak menyebut seseorang padahal tidak ada
  // yang tercatat — dan nama itu ikut tercetak di struk.
  const activeCashierName = currentUser?.name || shift.cashierName || '—';

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

      {/* 1. TOP HEADER: STORE PROFILE, SHIFT STATUS & TIME RANGE FILTER */}
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
                <span>Pengguna Aktif: {currentUser?.name || '—'} ({currentUser?.role || '—'})</span>
              </span>
              {shift.status === 'OPEN' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/40 animate-pulse">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Shift Terbuka (Petugas: {activeCashierName}, Kas Awal: {formatRupiah(shift.initialCash || 0)})</span>
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
              <h1 className="text-2xl lg:text-3xl font-black text-white tracking-tight flex items-center gap-3">
                <span>Executive Store Dashboard</span>
                <span className="text-xs px-2.5 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold">
                  Live Insight
                </span>
              </h1>
              <p className="text-xs lg:text-sm text-slate-300 max-w-2xl mt-1 font-medium leading-relaxed">
                Pusat kontrol & analitik bisnis: pantau omzet riil, modal terpakai (HPP), estimasi laba bersih (*net profit*), pajak terkumpul, dan preferensi cara bayar pelanggan.
              </p>
            </div>
          </div>

          {/* Quick Actions & Range Selector */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 shrink-0">
            {/* Time Filter Pill */}
            <div className="bg-slate-800/90 border border-slate-700 p-1 rounded-2xl flex items-center space-x-1 shadow-inner">
              {(['TODAY', '7DAYS', '30DAYS'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTimeFilter(t)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                    timeFilter === t
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {t === 'TODAY' ? 'Hari Ini' : t === '7DAYS' ? '7 Hari' : '30 Hari'}
                </button>
              ))}
            </div>

            <button
              onClick={() => setActiveTab('pos')}
              className="px-5 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/25 transition-all flex items-center gap-2 active:scale-95 cursor-pointer"
            >
              <ShoppingCart className="w-4 h-4 text-slate-950" />
              <span>Buka Kasir (POS)</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. EXECUTIVE FINANCIAL & PROFITABILITY CARDS GRID (5 INSIGHT CARDS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Omzet Penjualan (Gross Revenue) */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs space-y-3 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Omzet Penjualan</span>
            <div className="p-2.5 rounded-2xl bg-amber-50 text-amber-600 border border-amber-100">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div>
            <p className="text-2xl font-black text-slate-900 tracking-tight font-mono">
              {formatRupiah(financialMetrics.netRevenue)}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="inline-flex items-center text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>{financialMetrics.orderCount} Transaksi</span>
              </span>
              <span className="text-[11px] text-slate-400">{timeFilterLabel}</span>
            </div>
          </div>
        </div>

        {/* Modal HPP / Bahan Baku Terpakai (COGS) */}
        <div className="bg-white rounded-3xl p-5 border border-rose-200/80 shadow-xs space-y-3 relative overflow-hidden bg-rose-50/15">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-rose-800 uppercase tracking-wider">Modal Terpakai (HPP)</span>
            <div className="p-2.5 rounded-2xl bg-rose-100 text-rose-700 border border-rose-200">
              <TrendingDown className="w-5 h-5" />
            </div>
          </div>
          <div>
            <p className="text-2xl font-black text-rose-700 tracking-tight font-mono">
              {formatRupiah(financialMetrics.totalCOGS)}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="inline-flex items-center text-xs font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-md">
                Beban Modal
              </span>
              <span className="text-[11px] text-slate-500">untuk {financialMetrics.itemsSold} item terjual</span>
            </div>
          </div>
        </div>

        {/* Estimasi Laba Bersih (Net Profit) */}
        <div className="bg-white rounded-3xl p-5 border border-emerald-200/80 shadow-xs space-y-3 relative overflow-hidden bg-emerald-50/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-emerald-800 uppercase tracking-wider">Estimasi Laba Bersih</span>
            <div className="p-2.5 rounded-2xl bg-emerald-100 text-emerald-700 border border-emerald-200">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div>
            <p className="text-2xl font-black text-emerald-700 tracking-tight font-mono">
              {formatRupiah(financialMetrics.grossProfit)}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="inline-flex items-center text-xs font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                Margin Bersih {financialMetrics.netProfitMargin}%
              </span>
            </div>
          </div>
        </div>

        {/* Total Pajak & Service Charge */}
        <div className="bg-white rounded-3xl p-5 border border-blue-200/80 shadow-xs space-y-3 relative overflow-hidden bg-blue-50/15">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-blue-800 uppercase tracking-wider">Pajak &amp; Service</span>
            <div className="p-2.5 rounded-2xl bg-blue-100 text-blue-700 border border-blue-200">
              <Coins className="w-5 h-5" />
            </div>
          </div>
          <div>
            <p className="text-2xl font-black text-blue-800 tracking-tight font-mono">
              {formatRupiah(financialMetrics.taxTotal + financialMetrics.serviceChargeTotal)}
            </p>
            <div className="flex items-center justify-between text-[10px] text-slate-500 font-semibold mt-1">
              <span className="text-amber-700">Pajak: {formatRupiah(financialMetrics.taxTotal)}</span>
              <span className="text-blue-700">Svc: {formatRupiah(financialMetrics.serviceChargeTotal)}</span>
            </div>
          </div>
        </div>

        {/* Arus Kas Fisik vs Digital (Cash vs Cashless) DENGAN BAR & BREAKDOWN POPULER */}
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs space-y-2.5 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Arus Kas Masuk</span>
            <div className="p-2.5 rounded-2xl bg-purple-50 text-purple-700 border border-purple-100">
              <Wallet className="w-5 h-5" />
            </div>
          </div>

          {/* Dual Bar: Tunai vs Non-Tunai */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700 flex items-center gap-1">
                <Banknote className="w-3.5 h-3.5 text-emerald-600" /> Tunai ({financialMetrics.cashPercent}%):
              </span>
              <span className="font-mono font-extrabold text-slate-900">{formatRupiah(financialMetrics.cashSales)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700 flex items-center gap-1">
                <QrCode className="w-3.5 h-3.5 text-purple-600" /> Non-Tunai ({financialMetrics.cashlessPercent}%):
              </span>
              <span className="font-mono font-extrabold text-slate-900">{formatRupiah(financialMetrics.cashlessSales)}</span>
            </div>

            {/* Proportion Bar */}
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden flex mt-1">
              <div
                style={{ width: `${financialMetrics.netRevenue > 0 ? financialMetrics.cashPercent : 50}%` }}
                className="h-full bg-emerald-500 transition-all duration-500"
                title={`Tunai: ${financialMetrics.cashPercent}%`}
              />
              <div
                style={{ width: `${financialMetrics.netRevenue > 0 ? financialMetrics.cashlessPercent : 50}%` }}
                className="h-full bg-purple-500 transition-all duration-500"
                title={`Non-Tunai: ${financialMetrics.cashlessPercent}%`}
              />
            </div>
          </div>

          {/* Highlight Metode Paling Sering Digunakan Pelanggan */}
          <div className="pt-2 border-t border-slate-100">
            {financialMetrics.mostUsedMethod ? (
              <div className="bg-amber-50/80 border border-amber-200/80 p-2 rounded-xl text-[11px] text-amber-900 flex items-center justify-between">
                <span className="font-bold flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />
                  <span>Favorit: <strong>{financialMetrics.mostUsedMethod.name}</strong></span>
                </span>
                <span className="font-mono font-black text-amber-700">
                  {financialMetrics.mostUsedMethod.count}x ({financialMetrics.mostUsedMethod.percentage}%)
                </span>
              </div>
            ) : (
              <div className="text-[10px] text-slate-400 text-center py-1">
                Belum ada transaksi
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. MINI P&L STATEMENT (RINGKASAN LABA RUGI) & SMART AI ADVISOR */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Laporan Laba Rugi Eksekutif (Mini P&L Statement) */}
        <div className="lg:col-span-2 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-amber-500" />
                <span>Ringkasan Laba Rugi Operasional ({timeFilterLabel})</span>
              </h2>
              <p className="text-xs text-slate-500">Transparansi struktur pendapatan, modal bahan baku, potongan diskon, dan margin</p>
            </div>
            <span className={`text-xs font-extrabold px-3 py-1 rounded-xl border ${
              financialMetrics.netProfitMargin >= 50
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}>
              Kesehatan Margin: {financialMetrics.netProfitMargin >= 50 ? '🌟 Sangat Sehat' : '👍 Baik'} ({financialMetrics.netProfitMargin}%)
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-medium">
            {/* Kolom 1: Pendapatan & Diskon */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5">
              <div className="flex justify-between text-slate-600">
                <span>Penjualan Kotor (Gross Sales):</span>
                <span className="font-mono font-bold text-slate-900">{formatRupiah(financialMetrics.grossSales)}</span>
              </div>
              <div className="flex justify-between text-rose-600">
                <span>(-) Potongan Diskon Promo:</span>
                <span className="font-mono font-bold">-{formatRupiah(financialMetrics.discountTotal)}</span>
              </div>
              <div className="flex justify-between text-slate-800 pt-2 border-t border-slate-200 font-bold">
                <span>(=) Total Omzet Kasir:</span>
                <span className="font-mono text-slate-950 font-black text-sm">{formatRupiah(financialMetrics.netRevenue)}</span>
              </div>
              <div className="flex justify-between text-slate-500 text-[11px] pt-1">
                <span>Rata-Rata per Struk (AOV):</span>
                <span className="font-mono">{formatRupiah(financialMetrics.averageOrderValue)}</span>
              </div>
            </div>

            {/* Kolom 2: Beban Modal & Profit Bersih */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5">
              <div className="flex justify-between text-rose-700">
                <span>(-) Beban Pokok / Modal HPP:</span>
                <span className="font-mono font-bold">-{formatRupiah(financialMetrics.totalCOGS)}</span>
              </div>
              <div className="flex justify-between text-amber-700">
                <span>(-) Alokasi Setor Pajak (PB1):</span>
                <span className="font-mono font-bold">-{formatRupiah(financialMetrics.taxTotal)}</span>
              </div>
              <div className="flex justify-between text-emerald-700 pt-2 border-t border-slate-200 font-extrabold">
                <span>(=) Estimasi Laba Bersih:</span>
                <span className="font-mono text-emerald-700 font-black text-sm">{formatRupiah(financialMetrics.grossProfit)}</span>
              </div>
              <div className="flex justify-between text-blue-700 text-[11px] pt-1">
                <span>Alokasi Dana Layanan (Service):</span>
                <span className="font-mono">{formatRupiah(financialMetrics.serviceChargeTotal)}</span>
              </div>
            </div>
          </div>

          {/* Progress Margin Bar */}
          <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-amber-400">Komposisi Omzet Terhadap Modal &amp; Laba:</span>
              <span className="text-slate-300 font-mono">
                Modal: {financialMetrics.netRevenue > 0 ? Math.round((financialMetrics.totalCOGS / financialMetrics.netRevenue) * 100) : 0}% | Laba: {financialMetrics.netProfitMargin}%
              </span>
            </div>
            <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden flex">
              <div
                style={{
                  width: `${financialMetrics.netRevenue > 0 ? (financialMetrics.totalCOGS / financialMetrics.netRevenue) * 100 : 40}%`,
                }}
                className="h-full bg-rose-500"
                title="Beban Modal HPP"
              />
              <div
                style={{
                  width: `${financialMetrics.netRevenue > 0 ? (financialMetrics.taxTotal / financialMetrics.netRevenue) * 100 : 10}%`,
                }}
                className="h-full bg-amber-500"
                title="Pajak PB1"
              />
              <div
                style={{
                  width: `${financialMetrics.netRevenue > 0 ? (financialMetrics.grossProfit / financialMetrics.netRevenue) * 100 : 50}%`,
                }}
                className="h-full bg-emerald-500"
                title="Laba Bersih"
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> Modal Bahan Baku</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Pajak Daerah</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Laba Bersih Toko</span>
            </div>
          </div>
        </div>

        {/* Smart AI Financial & Business Advisor Card */}
        <div className="bg-gradient-to-br from-purple-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 border border-purple-700/40 shadow-xl space-y-4 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/15 rounded-full blur-3xl pointer-events-none" />

          <div className="space-y-3.5 relative z-10">
            <div className="flex items-center space-x-2">
              <div className="p-2 bg-purple-500 text-white rounded-xl">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-base text-white">AI Financial Copilot</h3>
                <p className="text-[11px] text-purple-300">Analisis Otomatis Kinerja Toko</p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white/10 backdrop-blur-md border border-white/10 text-xs text-purple-100 space-y-2.5 leading-relaxed font-medium">
              <p className="font-bold text-amber-300 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" />
                <span>Insight Finansial Realtime:</span>
              </p>
              <p>
                {financialMetrics.netProfitMargin >= 50
                  ? `Margin keuntungan toko Anda sangat kuat di angka ${financialMetrics.netProfitMargin}%. Modal bahan baku (${formatRupiah(financialMetrics.totalCOGS)}) terkendali dengan sangat efisien!`
                  : `Toko mencatatkan omzet ${formatRupiah(financialMetrics.netRevenue)} dengan estimasi laba ${formatRupiah(financialMetrics.grossProfit)}. Tingkatkan penjualan menu bermargin tinggi untuk mendongkrak profit!`}
              </p>
              {lowStockProducts.length > 0 && (
                <p className="text-amber-200 text-[11px] pt-1 border-t border-white/10">
                  ⚠️ Peringatan: Ada {lowStockProducts.length} produk yang stoknya menipis. Segera restok agar penjualan tidak terhambat!
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => setActiveTab('ai')}
            className="w-full py-3 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-xs transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-95 relative z-10"
          >
            <Sparkles className="w-4 h-4 text-slate-950" />
            <span>Konsultasi AI Copilot Lengkap ➔</span>
          </button>
        </div>
      </div>

      {/* 4. SECTOR SWITCHER & TOP PROFITABLE PRODUCTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sektor Mode Switcher (5 Business Presets) */}
        <div className="lg:col-span-2 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-500" />
                <span>Pilih Mode Format Bisnis Toko</span>
              </h2>
              <p className="text-xs text-slate-500">Sesuaikan katalog produk, layout denah, dan alur kerja sesuai jenis usaha:</p>
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
                Fitur Unggulan Format {activePreset.name}:
              </span>
              {/* Dulu: "{activePreset.products.length} produk katalog bawaan".
                  Tidak ada katalog bawaan, dan tidak seharusnya ada — angka
                  itu selalu tertulis nol setelah preset dikosongkan, dan
                  menjanjikan isi yang tidak akan pernah muncul. */}
              <span className="text-[11px] text-slate-400 font-medium">{products.length} produk di katalog Anda</span>
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

        {/* Top Profitable Products List */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Flame className="w-5 h-5 text-amber-500" />
              <span>Produk Kontributor Profit</span>
            </h2>
            <span className="text-[10px] font-bold text-slate-400 uppercase">Top Sales</span>
          </div>

          <div className="space-y-3">
            {topProducts.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                Belum ada data penjualan produk pada periode {timeFilterLabel}.
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
                    <p className="text-[11px] text-slate-500 font-semibold">
                      Harga: {formatRupiah(item.product.price)} (HPP: {formatRupiah(item.product.costPrice)})
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-black text-xs text-emerald-700">+{formatRupiah(item.profit)}</p>
                    <p className="text-[10px] text-slate-400">{item.qty} item terjual</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 5. LIVE RECENT TRANSACTIONS FEED */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-slate-700" />
            <span>Transaksi Terkini Kasir ({orders.length})</span>
          </h2>
          <button
            onClick={() => setActiveTab('reports')}
            className="text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1 cursor-pointer"
          >
            <span>Lihat Semua di Laporan Lengkap</span>
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
  );
};

export default OverviewPage;
