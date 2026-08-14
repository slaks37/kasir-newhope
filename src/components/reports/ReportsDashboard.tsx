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

  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month'>('today');
  const [showEndShiftModal, setShowEndShiftModal] = useState(false);
  const [actualCashInput, setActualCashInput] = useState<string>(String(shift.expectedCash || 0));
  const [shiftSummary, setShiftSummary] = useState<any>(null);

  // Filter orders based on date range (voided / held orders never count as revenue)
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (o.status !== 'COMPLETED') return false;
      const orderDate = new Date(o.date);
      const now = new Date();
      if (dateFilter === 'today') {
        return orderDate.toDateString() === now.toDateString();
      }
      if (dateFilter === 'week') {
        const sevenDaysAgo = new Date(now.setDate(now.getDate() - 7));
        return orderDate >= sevenDaysAgo;
      }
      return true;
    });
  }, [orders, dateFilter]);

  const dateFilterLabel = useMemo(() => {
    if (dateFilter === 'today') return 'Hari Ini';
    if (dateFilter === 'week') return '7 Hari Terakhir';
    return 'Bulan Ini';
  }, [dateFilter]);

  // Aggregated High-level Metrics
  const totalRevenue = useMemo(() => filteredOrders.reduce((sum, o) => sum + (o.total || 0), 0), [filteredOrders]);
  const totalSubtotal = useMemo(() => filteredOrders.reduce((sum, o) => sum + (o.subtotal || o.total), 0), [filteredOrders]);
  const totalDiscount = useMemo(() => filteredOrders.reduce((sum, o) => sum + (o.discountTotal || 0), 0), [filteredOrders]);
  const totalTax = useMemo(() => filteredOrders.reduce((sum, o) => sum + (o.taxTotal || 0), 0), [filteredOrders]);
  const totalServiceCharge = useMemo(() => filteredOrders.reduce((sum, o) => sum + (o.serviceChargeTotal || 0), 0), [filteredOrders]);
  const totalOrders = filteredOrders.length;
  const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  // Calculate Net Profit
  const netProfit = useMemo(() => {
    let totalCost = 0;
    filteredOrders.forEach((o) => {
      o.items.forEach((item) => {
        const prod = products.find((p) => p.id === item.productId);
        const cost = prod ? prod.costPrice * item.quantity : item.unitPrice * 0.5 * item.quantity;
        totalCost += cost;
      });
    });
    return Math.max(0, totalRevenue - totalCost - totalTax);
  }, [filteredOrders, products, totalRevenue, totalTax]);

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
      settings,
      periodLabel: dateFilterLabel,
      userName: currentUser?.name || 'Kasir / Admin',
    });
  };

  const handleExportPDF = () => {
    exportOrdersToPDF({
      orders: filteredOrders,
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
    <div className="flex-1 bg-slate-50/70 p-6 overflow-y-auto space-y-6">
      {/* Header with Title, Period Selector & Export Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-black text-2xl text-slate-900 flex items-center space-x-2.5">
            <BarChart3 className="w-7 h-7 text-amber-600" />
            <span>Laporan Penjualan, Pajak & Analitik</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Laporan lengkap omzet riil, rincian pungutan pajak PB1/PPN, service charge, profit margin, dan rekap shift kasir.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Date Range Selector */}
          <div className="bg-white border border-slate-200 p-1 rounded-2xl flex items-center space-x-1 shadow-xs">
            {(['today', 'week', 'month'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setDateFilter(range)}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                  dateFilter === range
                    ? 'bg-amber-500 text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {range === 'today' ? 'Hari Ini' : range === 'week' ? '7 Hari Terakhir' : 'Bulan Ini'}
              </button>
            ))}
          </div>

          {/* Export to Excel (.xls) Button */}
          <button
            onClick={handleExportExcel}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-4 py-2.5 rounded-2xl flex items-center space-x-2 text-xs transition-all shadow-md active:scale-95 cursor-pointer"
            title="Download Laporan Format Excel (.xls) dengan kolom Pajak & Service Charge"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export Excel</span>
          </button>

          {/* Export to PDF / Print Button */}
          <button
            onClick={handleExportPDF}
            className="bg-slate-900 hover:bg-slate-800 text-white font-black px-4 py-2.5 rounded-2xl flex items-center space-x-2 text-xs transition-all shadow-md active:scale-95 cursor-pointer"
            title="Cetak atau Simpan Laporan PDF Resmi A4"
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

      {/* High-Level Financial & Tax Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Omset */}
        <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Total Omzet Bersih</span>
            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl border border-amber-200">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <span className="text-2xl font-black text-slate-900 font-mono block">
            {formatRupiah(totalRevenue)}
          </span>
          <span className="text-[11px] text-emerald-600 font-bold block">
            ↑ {totalOrders} Pesanan Selesai
          </span>
        </div>

        {/* Total Pajak (PB1/PPN) */}
        <div className="bg-white border border-amber-200/80 p-5 rounded-3xl space-y-2 shadow-xs bg-amber-50/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-amber-800 uppercase tracking-wider">Pajak (PB1/PPN)</span>
            <div className="p-2 bg-amber-100 text-amber-800 rounded-xl border border-amber-300">
              <Percent className="w-5 h-5" />
            </div>
          </div>
          <span className="text-2xl font-black text-amber-700 font-mono block">
            {formatRupiah(totalTax)}
          </span>
          <span className="text-[11px] text-amber-800 font-semibold block">
            Tarif Toko: {settings.taxRate || 0}%
          </span>
        </div>

        {/* Total Service Charge */}
        <div className="bg-white border border-blue-200/80 p-5 rounded-3xl space-y-2 shadow-xs bg-blue-50/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-blue-800 uppercase tracking-wider">Service Charge</span>
            <div className="p-2 bg-blue-100 text-blue-800 rounded-xl border border-blue-300">
              <Coins className="w-5 h-5" />
            </div>
          </div>
          <span className="text-2xl font-black text-blue-700 font-mono block">
            {formatRupiah(totalServiceCharge)}
          </span>
          <span className="text-[11px] text-blue-800 font-semibold block">
            Tarif Layanan: {settings.serviceRate || 0}%
          </span>
        </div>

        {/* Estimasi Profit Bersih */}
        <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Estimasi Profit</span>
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-200">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <span className="text-2xl font-black text-emerald-600 font-mono block">
            {formatRupiah(netProfit)}
          </span>
          <span className="text-[11px] text-slate-500 font-semibold block">
            Margin Bersih ~{totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0}%
          </span>
        </div>

        {/* Rata-Rata Order (AOV) */}
        <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Rata-Rata Struk</span>
            <div className="p-2 bg-purple-50 text-purple-600 rounded-xl border border-purple-200">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <span className="text-2xl font-black text-slate-900 font-mono block">
            {formatRupiah(avgOrderValue)}
          </span>
          <span className="text-[11px] text-slate-500 font-semibold block">Nilai Belanja per Struk</span>
        </div>
      </div>

      {/* Visual Recharts Section */}
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

      {/* DETAIL TABLE: LAPORAN SEMUA TRANSAKSI, PAJAK & SERVICE CHARGE */}
      <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="font-black text-base text-slate-900 flex items-center space-x-2">
              <Receipt className="w-5 h-5 text-amber-600" />
              <span>Rincian Transaksi, Pajak &amp; Service Charge ({filteredOrders.length} Struk)</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Daftar seluruh transaksi yang masuk ke pembukuan lengkap dengan komponen pajak dan biaya layanan.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportExcel}
              className="text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Unduh Excel</span>
            </button>
            <button
              onClick={handleExportPDF}
              className="text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Cetak PDF</span>
            </button>
          </div>
        </div>

        {filteredOrders.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            Tidak ada transaksi pada periode {dateFilterLabel}.
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
                  <th className="py-3 px-3 text-right text-amber-700 font-black">Pajak (PB1)</th>
                  <th className="py-3 px-3 text-right text-blue-700 font-black">Service</th>
                  <th className="py-3 px-3 text-right text-slate-900 font-black">Total Akhir</th>
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

                  return (
                    <tr key={o.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-3 font-bold text-slate-900">{o.id}</td>
                      <td className="py-3 px-3 text-slate-600 font-sans text-[11px]">{formatDateTime(o.date)}</td>
                      <td className="py-3 px-3 font-sans text-slate-800">{o.customer?.name || '-'}</td>
                      <td className="py-3 px-3 font-sans text-slate-600">{o.cashierName || 'Kasir'}</td>
                      <td className="py-3 px-3 text-right text-slate-700">{formatRupiah(sub)}</td>
                      <td className="py-3 px-3 text-right text-rose-600">{disc > 0 ? `-${formatRupiah(disc)}` : '-'}</td>
                      <td className="py-3 px-3 text-right text-amber-800 font-bold bg-amber-50/40">{formatRupiah(tax)}</td>
                      <td className="py-3 px-3 text-right text-blue-800 font-bold bg-blue-50/40">{formatRupiah(svc)}</td>
                      <td className="py-3 px-3 text-right text-slate-950 font-black">{formatRupiah(tot)}</td>
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
                  <td className="py-3.5 px-3 text-right font-mono">{formatRupiah(totalSubtotal)}</td>
                  <td className="py-3.5 px-3 text-right font-mono text-rose-300">-{formatRupiah(totalDiscount)}</td>
                  <td className="py-3.5 px-3 text-right font-mono text-amber-300 font-black">{formatRupiah(totalTax)}</td>
                  <td className="py-3.5 px-3 text-right font-mono text-blue-300 font-black">{formatRupiah(totalServiceCharge)}</td>
                  <td className="py-3.5 px-3 text-right font-mono text-emerald-400 font-black text-sm">{formatRupiah(totalRevenue)}</td>
                  <td colSpan={2} className="py-3.5 px-3 text-center font-sans text-[10px] text-slate-300">LUNAS</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top 5 Products Bar Chart */}
      <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
        <h3 className="font-black text-base text-slate-900 flex items-center space-x-2">
          <ShoppingBag className="w-5 h-5 text-emerald-600" />
          <span>5 Produk Terlaris (Top Sellers)</span>
        </h3>

        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topProductsBarData} layout="vertical">
              <XAxis type="number" stroke="#64748b" fontSize={11} />
              <YAxis dataKey="name" type="category" stroke="#64748b" fontSize={11} width={150} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  borderColor: '#e2e8f0',
                  borderRadius: '12px',
                  color: '#0f172a',
                }}
                formatter={(value: any) => [`${value} Porsi/Unit`, 'Terjual']}
              />
              <Bar dataKey="qty" fill="#10b981" radius={[0, 8, 8, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Laporan HPP & Profitabilitas per Menu */}
      <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <h3 className="font-black text-base text-slate-900 flex items-center space-x-2">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            <span>Laporan HPP (Harga Pokok Penjualan) & Margin Profit per Item</span>
          </h3>
          <span className="text-xs text-slate-500 font-sans">
            Analisis profitabilitas modal bahan baku vs harga jual
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-sans">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 font-extrabold uppercase text-[10px] tracking-wider">
                <th className="py-2.5 px-3">Nama Produk / Menu</th>
                <th className="py-2.5 px-3">Harga Jual</th>
                <th className="py-2.5 px-3">HPP / Modal</th>
                <th className="py-2.5 px-3">Laba Kotor (Profit)</th>
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
                    <td className="py-3 px-3 text-amber-800 font-semibold">{formatRupiah(p.costPrice)}</td>
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

      {/* Shift Session Activity Log Table */}
      <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <h3 className="font-black text-base text-slate-900 flex items-center space-x-2">
            <Clock className="w-5 h-5 text-amber-600" />
            <span>Log Sesi & Rekap Shift Kasir</span>
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
