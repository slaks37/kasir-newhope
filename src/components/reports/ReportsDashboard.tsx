import React, { useState, useMemo } from 'react';
import { usePOS } from '../../context/POSContext';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import { exportOrdersToExcel, exportOrdersToPDF } from '../../utils/reportExporter';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  ShoppingBag,
  Users,
  PieChart as PieChartIcon,
  Download,
  Clock,
  X,
  FileSpreadsheet,
  Printer,
  Receipt,
  Percent,
  Coins,
  CreditCard,
  Building,
  CheckCircle2,
  Calendar,
  TrendingDown,
  Search,
  Filter,
  Layers,
  ArrowUpRight,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

export const ReportsDashboard: React.FC = () => {
  const { orders, products, shift, shiftHistory, endShift, settings, currentUser } = usePOS();

  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month' | 'all'>('today');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('ALL');
  const [showEndShiftModal, setShowEndShiftModal] = useState(false);
  const [actualCashInput, setActualCashInput] = useState<string>(String(shift.expectedCash || 0));
  const [shiftSummary, setShiftSummary] = useState<any>(null);

  // Filter orders based on date range
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (o.status !== 'COMPLETED') return false;
      const orderDate = new Date(o.date);
      const now = new Date();

      if (dateFilter === 'today') {
        if (orderDate.toDateString() !== now.toDateString()) return false;
      } else if (dateFilter === 'week') {
        const past7 = new Date();
        past7.setDate(past7.getDate() - 7);
        if (orderDate < past7) return false;
      } else if (dateFilter === 'month') {
        const past30 = new Date();
        past30.setDate(past30.getDate() - 30);
        if (orderDate < past30) return false;
      }

      if (selectedPaymentMethod !== 'ALL' && o.paymentMethod !== selectedPaymentMethod) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchId = o.id.toLowerCase().includes(q);
        const matchCustomer = o.customer?.name?.toLowerCase().includes(q);
        const matchCashier = o.cashierName?.toLowerCase().includes(q);
        if (!matchId && !matchCustomer && !matchCashier) return false;
      }

      return true;
    });
  }, [orders, dateFilter, selectedPaymentMethod, searchQuery]);

  const dateFilterLabel = useMemo(() => {
    if (dateFilter === 'today') return 'Hari Ini';
    if (dateFilter === 'week') return '7 Hari Terakhir';
    if (dateFilter === 'month') return 'Bulan Ini (30 Hari)';
    return 'Semua Riwayat';
  }, [dateFilter]);

  // Aggregated High-level Metrics & Unit Economics
  const financialSummary = useMemo(() => {
    let totalGrossSales = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    let totalServiceCharge = 0;
    let totalNetRevenue = 0;
    let totalCOGS = 0; // Total Modal Bahan Baku

    filteredOrders.forEach((o) => {
      totalNetRevenue += o.total || 0;
      totalGrossSales += (o.subtotal || o.total) + (o.discountTotal || 0);
      totalDiscount += o.discountTotal || 0;
      totalTax += o.taxTotal || 0;
      totalServiceCharge += o.serviceChargeTotal || 0;

      o.items.forEach((item) => {
        const prod = products.find((p) => p.id === item.productId);
        const cost = prod ? prod.costPrice : item.unitPrice * 0.45;
        totalCOGS += cost * item.quantity;
      });
    });

    const grossProfit = Math.max(0, totalNetRevenue - totalCOGS - totalTax);
    const netProfitMargin = totalNetRevenue > 0 ? (grossProfit / totalNetRevenue) * 100 : 0;
    const avgOrderValue = filteredOrders.length > 0 ? Math.round(totalNetRevenue / filteredOrders.length) : 0;

    return {
      totalGrossSales,
      totalDiscount,
      totalTax,
      totalServiceCharge,
      totalNetRevenue,
      totalCOGS,
      grossProfit,
      netProfitMargin: Math.round(netProfitMargin * 10) / 10,
      avgOrderValue,
      totalOrders: filteredOrders.length,
    };
  }, [filteredOrders, products]);

  // Payment Method Distribution Chart Data
  const paymentBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    filteredOrders.forEach((o) => {
      map[o.paymentMethod] = (map[o.paymentMethod] || 0) + o.total;
    });
    return map;
  }, [filteredOrders]);

  const pieChartData = useMemo(() => {
    return Object.keys(paymentBreakdown).map((method) => ({
      name: method,
      value: paymentBreakdown[method],
    }));
  }, [paymentBreakdown]);

  const PIE_COLORS = ['#10b981', '#f59e0b', '#6366f1', '#ec4899', '#8b5cf6', '#06b6d4'];

  // Top 5 Selling Products Data
  const topProductsBarData = useMemo(() => {
    const productSalesCount: Record<string, { name: string; qty: number; revenue: number }> = {};
    filteredOrders.forEach((o) => {
      o.items.forEach((item) => {
        if (!productSalesCount[item.name]) {
          productSalesCount[item.name] = { name: item.name, qty: 0, revenue: 0 };
        }
        productSalesCount[item.name].qty += item.quantity;
        productSalesCount[item.name].revenue += item.totalPrice;
      });
    });

    return Object.values(productSalesCount)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [filteredOrders]);

  // Hourly Sales Trend Data
  const TREND_START_HOUR = 8;
  const TREND_END_HOUR = 22;
  const areaChartData = useMemo(() => {
    const hourlyTrendMap: Record<string, number> = {};
    for (let h = TREND_START_HOUR; h <= TREND_END_HOUR; h++) {
      hourlyTrendMap[`${String(h).padStart(2, '0')}:00`] = 0;
    }

    filteredOrders.forEach((o) => {
      const hour = `${String(new Date(o.date).getHours()).padStart(2, '0')}:00`;
      if (hourlyTrendMap[hour] !== undefined) {
        hourlyTrendMap[hour] += o.total;
      }
    });

    return Object.keys(hourlyTrendMap)
      .sort()
      .map((time) => ({
        time,
        Omset: hourlyTrendMap[time],
      }));
  }, [filteredOrders]);

  // Export handlers
  const handleExportExcel = () => {
    exportOrdersToExcel({
      orders: filteredOrders,
      products,
      settings,
      periodLabel: dateFilterLabel,
      userName: currentUser?.name || 'Kasir / Admin',
    });
  };

  const handleExportPDF = () => {
    exportOrdersToPDF({
      orders: filteredOrders,
      products,
      settings,
      periodLabel: dateFilterLabel,
      userName: currentUser?.name || 'Kasir / Admin',
    });
  };

  const handleConfirmEndShift = (e: React.FormEvent) => {
    e.preventDefault();
    const actual = Number(actualCashInput) || 0;
    const summary = endShift(actual);
    setShiftSummary(summary);
  };

  return (
    <div className="flex-1 bg-slate-50/70 p-4 lg:p-8 overflow-y-auto space-y-6 animate-fade-in">
      {/* Header with Title, Range Selector & Export Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-black text-2xl lg:text-3xl text-slate-900 flex items-center space-x-3">
            <BarChart3 className="w-8 h-8 text-amber-600" />
            <span>Laporan Finansial, HPP &amp; Pajak</span>
          </h2>
          <p className="text-xs lg:text-sm text-slate-500 mt-1 font-medium">
            Laporan pembukuan lengkap tingkat enterprise: omzet riil, modal terpakai (HPP), estimasi laba bersih, setoran pajak daerah (PB1), dan service charge.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Date Range Selector */}
          <div className="bg-white border border-slate-200 p-1 rounded-2xl flex items-center space-x-1 shadow-xs">
            {(['today', 'week', 'month', 'all'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setDateFilter(range)}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                  dateFilter === range
                    ? 'bg-amber-500 text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {range === 'today' ? 'Hari Ini' : range === 'week' ? '7 Hari' : range === 'month' ? '30 Hari' : 'Semua'}
              </button>
            ))}
          </div>

          {/* Export to Excel (.xls) Button */}
          <button
            onClick={handleExportExcel}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-4 py-2.5 rounded-2xl flex items-center space-x-2 text-xs transition-all shadow-md active:scale-95 cursor-pointer"
            title="Download Laporan Format Excel (.xls) Lengkap dengan HPP, Pajak & Service Charge"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export Excel</span>
          </button>

          {/* Export to PDF / Print Button */}
          <button
            onClick={handleExportPDF}
            className="bg-slate-900 hover:bg-slate-800 text-white font-black px-4 py-2.5 rounded-2xl flex items-center space-x-2 text-xs transition-all shadow-md active:scale-95 cursor-pointer"
            title="Cetak atau Simpan Dokumen Laporan PDF Resmi A4"
          >
            <Printer className="w-4 h-4 text-amber-400" />
            <span>Cetak / PDF</span>
          </button>

          {/* Tutup Kasir / Shift Button */}
          <button
            onClick={() => setShowEndShiftModal(true)}
            className="bg-rose-600 hover:bg-rose-700 text-white font-black px-4 py-2.5 rounded-2xl text-xs shadow-md transition-all active:scale-95 cursor-pointer"
          >
            Tutup Kasir / Shift
          </button>
        </div>
      </div>

      {/* 1. PRIMARY FINANCIAL & TAX METRICS CARDS (5 BIG CARDS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Omset Bersih */}
        <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Total Omzet Bersih</span>
            <div className="p-2.5 bg-amber-50 text-amber-600 rounded-2xl border border-amber-200">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <span className="text-2xl font-black text-slate-900 font-mono block">
            {formatRupiah(financialSummary.totalNetRevenue)}
          </span>
          <span className="text-[11px] text-emerald-600 font-bold block">
            ↑ {financialSummary.totalOrders} Transaksi Terkonfirmasi
          </span>
        </div>

        {/* Modal HPP / Bahan Baku Terpakai */}
        <div className="bg-white border border-rose-200/80 p-5 rounded-3xl space-y-2 shadow-xs bg-rose-50/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-rose-800 uppercase tracking-wider">Modal Terpakai (HPP)</span>
            <div className="p-2.5 bg-rose-100 text-rose-700 rounded-2xl border border-rose-300">
              <TrendingDown className="w-5 h-5" />
            </div>
          </div>
          <span className="text-2xl font-black text-rose-700 font-mono block">
            {formatRupiah(financialSummary.totalCOGS)}
          </span>
          <span className="text-[11px] text-rose-800 font-semibold block">
            Beban Pokok Penjualan
          </span>
        </div>

        {/* Estimasi Laba Bersih (Net Profit) */}
        <div className="bg-white border border-emerald-200/80 p-5 rounded-3xl space-y-2 shadow-xs bg-emerald-50/25">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-emerald-800 uppercase tracking-wider">Estimasi Laba Bersih</span>
            <div className="p-2.5 bg-emerald-100 text-emerald-700 rounded-2xl border border-emerald-300">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <span className="text-2xl font-black text-emerald-700 font-mono block">
            {formatRupiah(financialSummary.grossProfit)}
          </span>
          <span className="text-[11px] text-emerald-800 font-black block">
            Net Margin {financialSummary.netProfitMargin}%
          </span>
        </div>

        {/* Pajak Daerah (PB1/PPN) */}
        <div className="bg-white border border-amber-200/80 p-5 rounded-3xl space-y-2 shadow-xs bg-amber-50/25">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-amber-800 uppercase tracking-wider">Pajak (PB1/PPN)</span>
            <div className="p-2.5 bg-amber-100 text-amber-800 rounded-2xl border border-amber-300">
              <Percent className="w-5 h-5" />
            </div>
          </div>
          <span className="text-2xl font-black text-amber-700 font-mono block">
            {formatRupiah(financialSummary.totalTax)}
          </span>
          <span className="text-[11px] text-amber-800 font-semibold block">
            Kewajiban Setor ({settings.taxRate || 0}%)
          </span>
        </div>

        {/* Service Charge (Biaya Layanan) */}
        <div className="bg-white border border-blue-200/80 p-5 rounded-3xl space-y-2 shadow-xs bg-blue-50/25">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-blue-800 uppercase tracking-wider">Service Charge</span>
            <div className="p-2.5 bg-blue-100 text-blue-800 rounded-2xl border border-blue-300">
              <Coins className="w-5 h-5" />
            </div>
          </div>
          <span className="text-2xl font-black text-blue-700 font-mono block">
            {formatRupiah(financialSummary.totalServiceCharge)}
          </span>
          <span className="text-[11px] text-blue-800 font-semibold block">
            Alokasi Staf ({settings.serviceRate || 0}%)
          </span>
        </div>
      </div>

      {/* 2. COMPREHENSIVE P&L STATEMENT (LAPORAN LABA RUGI OPERASIONAL) */}
      <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-black text-base lg:text-lg text-slate-900 flex items-center gap-2">
              <Building className="w-5 h-5 text-amber-600" />
              <span>Laporan Laba Rugi Usaha (P&amp;L Statement) — {dateFilterLabel}</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Rincian audit pendapatan riil, beban pokok modal produk (HPP), potongan promosi, dan kewajiban fiskal pajak.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-slate-100 rounded-xl text-xs font-bold text-slate-700">
              AOV: {formatRupiah(financialSummary.avgOrderValue)} / Struk
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Sisi Kiri: Pendapatan & Pungutan */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5 text-xs font-medium">
            <h4 className="font-black text-slate-900 text-xs uppercase tracking-wider border-b border-slate-200 pb-1.5 flex items-center justify-between">
              <span>Komponen Penjualan (Inflow)</span>
              <span className="text-[10px] text-slate-400 font-normal">Nominal (Rp)</span>
            </h4>
            <div className="flex justify-between text-slate-700">
              <span>Total Penjualan Kotor (Gross Sales):</span>
              <span className="font-mono font-bold text-slate-900">{formatRupiah(financialSummary.totalGrossSales)}</span>
            </div>
            <div className="flex justify-between text-rose-600">
              <span>(-) Diskon / Potongan Promo:</span>
              <span className="font-mono font-bold">-{formatRupiah(financialSummary.totalDiscount)}</span>
            </div>
            <div className="flex justify-between text-slate-900 font-black pt-2 border-t border-slate-200">
              <span>(=) Total Omzet Penjualan Bersih:</span>
              <span className="font-mono text-sm">{formatRupiah(financialSummary.totalNetRevenue)}</span>
            </div>
            <div className="flex justify-between text-blue-700 pt-1 text-[11px]">
              <span>(+) Dana Layanan / Service Charge:</span>
              <span className="font-mono font-bold">+{formatRupiah(financialSummary.totalServiceCharge)}</span>
            </div>
          </div>

          {/* Sisi Kanan: Beban Pokok (HPP), Pajak & Laba Bersih */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5 text-xs font-medium">
            <h4 className="font-black text-slate-900 text-xs uppercase tracking-wider border-b border-slate-200 pb-1.5 flex items-center justify-between">
              <span>Beban Pokok &amp; Laba (Outflow / Profit)</span>
              <span className="text-[10px] text-slate-400 font-normal">Nominal (Rp)</span>
            </h4>
            <div className="flex justify-between text-rose-700">
              <span>(-) Modal HPP Bahan Baku Terpakai (COGS):</span>
              <span className="font-mono font-bold">-{formatRupiah(financialSummary.totalCOGS)}</span>
            </div>
            <div className="flex justify-between text-amber-700">
              <span>(-) Pajak Daerah PB1 / PPN Terkumpul:</span>
              <span className="font-mono font-bold">-{formatRupiah(financialSummary.totalTax)}</span>
            </div>
            <div className="flex justify-between text-emerald-700 font-black text-sm pt-2 border-t border-slate-200 bg-emerald-50/60 p-2 rounded-xl">
              <span>(=) ESTIMASI LABA BERSIH (NET PROFIT):</span>
              <span className="font-mono">{formatRupiah(financialSummary.grossProfit)}</span>
            </div>
            <div className="flex justify-between text-slate-500 text-[11px] px-2">
              <span>Rasio Net Profit Margin:</span>
              <span className="font-bold text-emerald-700 font-mono">{financialSummary.netProfitMargin}% dari Omzet</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. CHARTS SECTION (HOURLY TREND & PAYMENT METHOD DISTRIBUTION) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Hourly Sales Trend Area Chart */}
        <div className="lg:col-span-8 bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-black text-base text-slate-900 flex items-center space-x-2">
              <TrendingUp className="w-5 h-5 text-amber-600" />
              <span>Grafik Tren Penjualan Jam Ke Jam</span>
            </h3>
            <span className="text-xs font-bold text-slate-400">08:00 - 22:00</span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={areaChartData}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  tickFormatter={(v) => `Rp${v / 1000}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderRadius: '12px',
                    color: '#0f172a',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                  }}
                  formatter={(value: any) => [formatRupiah(Number(value)), 'Omset']}
                />
                <Area
                  type="monotone"
                  dataKey="Omset"
                  stroke="#d97706"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorRevenue)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Payment Methods Pie Chart */}
        <div className="lg:col-span-4 bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-black text-base text-slate-900 flex items-center space-x-2">
              <PieChartIcon className="w-5 h-5 text-indigo-600" />
              <span>Distribusi Pembayaran</span>
            </h3>
          </div>

          <div className="h-52 w-full flex items-center justify-center">
            {pieChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {pieChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderColor: '#e2e8f0',
                      borderRadius: '12px',
                      color: '#0f172a',
                    }}
                    formatter={(value: any) => [formatRupiah(Number(value)), 'Total']}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <span className="text-xs text-slate-400">Belum ada transaksi</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-slate-100">
            {pieChartData.map((entry, idx) => (
              <div key={entry.name} className="flex items-center space-x-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                />
                <span className="text-slate-700 font-semibold truncate">{entry.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. DETAIL TABLE: LAPORAN SEMUA TRANSAKSI, MODAL HPP, PAJAK & SERVICE CHARGE */}
      <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="font-black text-base lg:text-lg text-slate-900 flex items-center space-x-2">
              <Receipt className="w-5 h-5 text-amber-600" />
              <span>Rincian Transaksi, Modal (HPP), Pajak &amp; Service Charge ({filteredOrders.length} Struk)</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Tabel lengkap transaksi kasir: subtotal, diskon, modal HPP, pajak PB1, service charge, total akhir, dan laba bersih per struk.
            </p>
          </div>

          {/* Filter Bar & Search */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Cari faktur, pelanggan, kasir..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none w-52"
              />
            </div>

            <select
              value={selectedPaymentMethod}
              onChange={(e) => setSelectedPaymentMethod(e.target.value)}
              className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
            >
              <option value="ALL">Semua Pembayaran</option>
              <option value="CASH">Tunai (Cash)</option>
              <option value="QRIS">QRIS</option>
              <option value="DEBIT">Debit Card</option>
              <option value="TRANSFER">Transfer Bank</option>
            </select>
          </div>
        </div>

        {filteredOrders.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            Tidak ada transaksi yang cocok dengan filter pada periode {dateFilterLabel}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-sans">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 font-extrabold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-3">No Faktur</th>
                  <th className="py-3 px-3">Waktu</th>
                  <th className="py-3 px-3">Pelanggan</th>
                  <th className="py-3 px-3">Kasir</th>
                  <th className="py-3 px-3 text-right">Subtotal</th>
                  <th className="py-3 px-3 text-right">Diskon</th>
                  <th className="py-3 px-3 text-right text-rose-700 font-black">Modal (HPP)</th>
                  <th className="py-3 px-3 text-right text-amber-700 font-black">Pajak (PB1)</th>
                  <th className="py-3 px-3 text-right text-blue-700 font-black">Service</th>
                  <th className="py-3 px-3 text-right text-slate-900 font-black">Total Net</th>
                  <th className="py-3 px-3 text-right text-emerald-700 font-black">Laba Bersih</th>
                  <th className="py-3 px-3 text-center">Metode</th>
                  <th className="py-3 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {filteredOrders.map((o) => {
                  const sub = o.subtotal || o.total;
                  const disc = o.discountTotal || 0;
                  const tax = o.taxTotal || 0;
                  const svc = o.serviceChargeTotal || 0;
                  const tot = o.total;

                  let orderCost = 0;
                  o.items.forEach((item) => {
                    const prod = products.find((p) => p.id === item.productId);
                    orderCost += (prod ? prod.costPrice : item.unitPrice * 0.45) * item.quantity;
                  });
                  const orderProfit = Math.max(0, tot - orderCost - tax);

                  return (
                    <tr key={o.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-3 font-bold text-slate-900">{o.id}</td>
                      <td className="py-3 px-3 text-slate-600 font-sans text-[11px]">{formatDateTime(o.date)}</td>
                      <td className="py-3 px-3 font-sans text-slate-800">{o.customer?.name || '-'}</td>
                      <td className="py-3 px-3 font-sans text-slate-600">{o.cashierName || 'Kasir'}</td>
                      <td className="py-3 px-3 text-right text-slate-700">{formatRupiah(sub)}</td>
                      <td className="py-3 px-3 text-right text-rose-600">{disc > 0 ? `-${formatRupiah(disc)}` : '-'}</td>
                      <td className="py-3 px-3 text-right text-rose-700 font-bold bg-rose-50/30">{formatRupiah(orderCost)}</td>
                      <td className="py-3 px-3 text-right text-amber-800 font-bold bg-amber-50/40">{formatRupiah(tax)}</td>
                      <td className="py-3 px-3 text-right text-blue-800 font-bold bg-blue-50/40">{formatRupiah(svc)}</td>
                      <td className="py-3 px-3 text-right text-slate-950 font-black">{formatRupiah(tot)}</td>
                      <td className="py-3 px-3 text-right text-emerald-700 font-black bg-emerald-50/40">{formatRupiah(orderProfit)}</td>
                      <td className="py-3 px-3 text-center font-sans">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          o.paymentMethod === 'QRIS' ? 'bg-purple-100 text-purple-800' : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {o.paymentMethod}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center font-sans">
                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px] px-2 py-0.5 rounded-md">
                          {o.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {/* Table Grand Total Summary Row */}
                <tr className="bg-slate-900 text-white font-bold text-xs">
                  <td colSpan={4} className="py-3.5 px-3 font-sans font-black uppercase tracking-wider text-amber-400">
                    TOTAL KESELURUHAN ({filteredOrders.length} TRANSAKSI)
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono">{formatRupiah(financialSummary.totalGrossSales)}</td>
                  <td className="py-3.5 px-3 text-right font-mono text-rose-300">-{formatRupiah(financialSummary.totalDiscount)}</td>
                  <td className="py-3.5 px-3 text-right font-mono text-rose-300 font-black">{formatRupiah(financialSummary.totalCOGS)}</td>
                  <td className="py-3.5 px-3 text-right font-mono text-amber-300 font-black">{formatRupiah(financialSummary.totalTax)}</td>
                  <td className="py-3.5 px-3 text-right font-mono text-blue-300 font-black">{formatRupiah(financialSummary.totalServiceCharge)}</td>
                  <td className="py-3.5 px-3 text-right font-mono text-white font-black text-sm">{formatRupiah(financialSummary.totalNetRevenue)}</td>
                  <td className="py-3.5 px-3 text-right font-mono text-emerald-400 font-black text-sm">{formatRupiah(financialSummary.grossProfit)}</td>
                  <td colSpan={2} className="py-3.5 px-3 text-center font-sans text-[10px] text-slate-300">LUNAS</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. LAPORAN HPP & PROFITABILITAS PER MENU PRODUK */}
      <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <h3 className="font-black text-base text-slate-900 flex items-center space-x-2">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            <span>Laporan Margin Profitabilitas Produk (HPP vs Harga Jual)</span>
          </h3>
          <span className="text-xs text-slate-500 font-sans">
            Analisis unit economics modal bahan baku vs harga jual
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-sans">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 font-extrabold uppercase text-[10px] tracking-wider">
                <th className="py-2.5 px-3">Nama Produk / Menu</th>
                <th className="py-2.5 px-3">Harga Jual</th>
                <th className="py-2.5 px-3">HPP / Modal</th>
                <th className="py-2.5 px-3">Laba Bersih per Item</th>
                <th className="py-2.5 px-3 text-right">Margin (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {products.map((p) => {
                const profit = p.price - p.costPrice;
                const marginPercent = p.price > 0 ? Math.round((profit / p.price) * 100) : 0;

                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="py-3 px-3 font-bold text-slate-900 font-sans">
                      <div className="flex items-center space-x-2">
                        {p.image && <img src={p.image} alt={p.name} className="w-6 h-6 object-cover rounded-lg" />}
                        <span>{p.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-extrabold text-slate-900">{formatRupiah(p.price)}</td>
                    <td className="py-3 px-3 text-rose-700 font-semibold">{formatRupiah(p.costPrice)}</td>
                    <td className="py-3 px-3 text-emerald-700 font-extrabold">{formatRupiah(profit)}</td>
                    <td className="py-3 px-3 text-right font-sans">
                      <span
                        className={`font-extrabold text-[10px] px-2 py-0.5 rounded-full ${
                          marginPercent >= 50
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : marginPercent >= 30
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-rose-100 text-rose-800 border border-rose-200'
                        }`}
                      >
                        {marginPercent}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 6. SHIFT SESSION ACTIVITY LOG TABLE */}
      <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <h3 className="font-black text-base text-slate-900 flex items-center space-x-2">
            <Clock className="w-5 h-5 text-amber-600" />
            <span>Log Sesi &amp; Rekap Shift Kasir</span>
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            Status Kasir: <strong className={shift.status === 'OPEN' ? 'text-emerald-600' : 'text-rose-600'}>{shift.status === 'OPEN' ? `● AKTIF (${shift.cashierName})` : '○ DITUTUP'}</strong>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-sans">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 font-extrabold uppercase text-[10px] tracking-wider">
                <th className="py-2.5 px-3">Kasir</th>
                <th className="py-2.5 px-3">Mulai Shift</th>
                <th className="py-2.5 px-3">Selesai Shift</th>
                <th className="py-2.5 px-3">Omzet Sesi</th>
                <th className="py-2.5 px-3">Expected Cash</th>
                <th className="py-2.5 px-3">Actual Cash</th>
                <th className="py-2.5 px-3">Selisih</th>
                <th className="py-2.5 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {/* Active shift row */}
              {shift.status === 'OPEN' && (
                <tr className="bg-amber-50/50 hover:bg-amber-50">
                  <td className="py-3 px-3 font-bold text-slate-900 font-sans">{shift.cashierName} (Aktif)</td>
                  <td className="py-3 px-3 text-slate-700">{formatDateTime(shift.startTime)}</td>
                  <td className="py-3 px-3 text-amber-700 italic font-sans font-semibold">Sedang Berlangsung...</td>
                  <td className="py-3 px-3 font-extrabold text-amber-800">{formatRupiah(shift.totalSales)}</td>
                  <td className="py-3 px-3 text-slate-700">{formatRupiah(shift.expectedCash)}</td>
                  <td className="py-3 px-3 text-slate-400 font-sans">-</td>
                  <td className="py-3 px-3 text-slate-400 font-sans">-</td>
                  <td className="py-3 px-3 text-right font-sans">
                    <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 font-extrabold text-[10px] px-2 py-0.5 rounded-full">
                      OPEN
                    </span>
                  </td>
                </tr>
              )}

              {/* History shifts */}
              {shiftHistory.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-3 font-bold text-slate-800 font-sans">{s.cashierName}</td>
                  <td className="py-3 px-3 text-slate-600">{formatDateTime(s.startTime)}</td>
                  <td className="py-3 px-3 text-slate-600">{s.endTime ? formatDateTime(s.endTime) : '-'}</td>
                  <td className="py-3 px-3 font-bold text-slate-900">{formatRupiah(s.totalSales)}</td>
                  <td className="py-3 px-3 text-slate-600">{formatRupiah(s.expectedCash)}</td>
                  <td className="py-3 px-3 text-slate-800 font-bold">{formatRupiah(s.actualCash || 0)}</td>
                  <td className={`py-3 px-3 font-bold ${(s.difference || 0) === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {formatRupiah(s.difference || 0)}
                  </td>
                  <td className="py-3 px-3 text-right font-sans">
                    <span className="bg-slate-100 text-slate-700 border border-slate-200 font-bold text-[10px] px-2 py-0.5 rounded-full">
                      CLOSED
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* End Shift Modal / Tutup Kasir */}
      {showEndShiftModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-md w-full text-slate-900 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-base text-rose-600 flex items-center space-x-2">
                <Clock className="w-5 h-5" />
                <span>Tutup Kasir / Rekap Shift</span>
              </h3>
              <button
                onClick={() => setShowEndShiftModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {shiftSummary ? (
              <div className="space-y-3 font-mono text-xs">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5">
                  <div className="flex justify-between text-slate-600">
                    <span>Kas Awal:</span>
                    <span>{formatRupiah(shiftSummary.initialCash)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Penjualan Tunai:</span>
                    <span>{formatRupiah(shiftSummary.cashSales)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Penjualan Non-Tunai (QRIS/Card):</span>
                    <span>{formatRupiah(shiftSummary.qrisSales + shiftSummary.cardSales)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-amber-700 pt-1 border-t border-slate-200">
                    <span>Ekspektasi Kas Fisik:</span>
                    <span>{formatRupiah(shiftSummary.expectedCash)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-slate-900">
                    <span>Fisik Kas Di Laci:</span>
                    <span>{formatRupiah(shiftSummary.actualCash)}</span>
                  </div>
                  <div
                    className={`flex justify-between font-extrabold pt-1 border-t border-slate-200 ${
                      shiftSummary.difference === 0
                        ? 'text-emerald-600'
                        : shiftSummary.difference > 0
                        ? 'text-indigo-600'
                        : 'text-rose-600'
                    }`}
                  >
                    <span>Selisih:</span>
                    <span>{formatRupiah(shiftSummary.difference)}</span>
                  </div>
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-[11px] text-center font-sans font-semibold">
                  ✅ Shift Resmi Ditutup. Laporan tersimpan dengan aman!
                </div>

                <button
                  onClick={() => {
                    setShowEndShiftModal(false);
                    setShiftSummary(null);
                  }}
                  className="w-full py-2.5 bg-amber-500 text-slate-950 font-bold rounded-xl text-xs font-sans hover:bg-amber-600 cursor-pointer"
                >
                  Selesai
                </button>
              </div>
            ) : (
              <form onSubmit={handleConfirmEndShift} className="space-y-4">
                <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-1 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Kas Awal:</span>
                    <span className="font-mono">{formatRupiah(shift.initialCash)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Total Penjualan Tunai:</span>
                    <span className="font-mono">{formatRupiah(shift.cashSales)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-amber-700 pt-1 border-t border-slate-200">
                    <span>Perhitungan Ekspektasi Uang Tunai:</span>
                    <span className="font-mono">{formatRupiah(shift.expectedCash)}</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Masukkan Jumlah Kas Fisik Di Laci (Hitung Manual):
                  </label>
                  <input
                    type="number"
                    required
                    value={actualCashInput}
                    onChange={(e) => setActualCashInput(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-base font-bold text-amber-700 font-mono focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowEndShiftModal(false)}
                    className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
                  >
                    Konfirmasi Tutup Kasir
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportsDashboard;
