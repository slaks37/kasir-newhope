import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
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
  const { orders, products, shift, shiftHistory, endShift } = usePOS();

  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month'>('today');
  const [showEndShiftModal, setShowEndShiftModal] = useState(false);
  const [actualCashInput, setActualCashInput] = useState<string>(String(shift.expectedCash));
  const [shiftSummary, setShiftSummary] = useState<any>(null);

  // Filter orders based on date range (voided / held orders never count as revenue)
  const filteredOrders = orders.filter((o) => {
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

  // Aggregated High-level Metrics
  const totalRevenue = filteredOrders.reduce((sum, o) => sum + o.total, 0);
  const totalOrders = filteredOrders.length;
  const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  // Calculate Net Profit
  let totalCost = 0;
  filteredOrders.forEach((o) => {
    o.items.forEach((item) => {
      const prod = products.find((p) => p.id === item.productId);
      const cost = prod ? prod.costPrice * item.quantity : item.unitPrice * 0.5 * item.quantity;
      totalCost += cost;
    });
  });
  const netProfit = Math.max(0, totalRevenue - totalCost);

  // Payment Method Distribution Chart Data
  const paymentBreakdown: Record<string, number> = {};
  filteredOrders.forEach((o) => {
    paymentBreakdown[o.paymentMethod] = (paymentBreakdown[o.paymentMethod] || 0) + o.total;
  });

  const pieChartData = Object.keys(paymentBreakdown).map((method) => ({
    name: method,
    value: paymentBreakdown[method],
  }));

  const PIE_COLORS = ['#10b981', '#f59e0b', '#6366f1', '#ec4899', '#8b5cf6'];

  // Top 5 Selling Products Data
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

  const topProductsBarData = Object.values(productSalesCount)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  // Hourly Sales Trend Data (real transactions only, 08:00 - 22:00 operating window)
  const TREND_START_HOUR = 8;
  const TREND_END_HOUR = 22;
  const hourlyTrendMap: Record<string, number> = {};
  for (let h = TREND_START_HOUR; h <= TREND_END_HOUR; h++) {
    hourlyTrendMap[`${String(h).padStart(2, '0')}:00`] = 0;
  }

  filteredOrders.forEach((o) => {
    const hour = `${String(new Date(o.date).getHours()).padStart(2, '0')}:00`;
    hourlyTrendMap[hour] = (hourlyTrendMap[hour] || 0) + o.total;
  });

  const areaChartData = Object.keys(hourlyTrendMap)
    .sort()
    .map((time) => ({
      time,
      Omset: hourlyTrendMap[time],
    }));

  const handleExportCSV = () => {
    const headers = ['No Faktur', 'Tanggal', 'Tipe Order', 'Pelanggan', 'Metode Bayar', 'Total'];
    const rows = filteredOrders.map((o) => [
      o.id,
      formatDateTime(o.date),
      o.orderType,
      o.customer?.name || '-',
      o.paymentMethod,
      o.total,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Laporan_Penjualan_NewHope_${dateFilter}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleConfirmEndShift = (e: React.FormEvent) => {
    e.preventDefault();
    const actual = Number(actualCashInput) || 0;
    const summary = endShift(actual);
    setShiftSummary(summary);
  };

  return (
    <div className="flex-1 bg-slate-50/70 p-6 overflow-y-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-extrabold text-2xl text-slate-900 flex items-center space-x-2">
            <BarChart3 className="w-7 h-7 text-amber-600" />
            <span>Laporan Penjualan & Analitik Bisnis</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Ringkasan omset rill, estimasi laba bersih, preferensi metode bayar, dan rekap shift kasir.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {/* Date Range Selector */}
          <div className="bg-white border border-slate-200 p-1 rounded-2xl flex items-center space-x-1 shadow-xs">
            {(['today', 'week', 'month'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setDateFilter(range)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  dateFilter === range
                    ? 'bg-amber-500 text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {range === 'today' ? 'Hari Ini' : range === 'week' ? '7 Hari Terakhir' : 'Bulan Ini'}
              </button>
            ))}
          </div>

          <button
            onClick={handleExportCSV}
            className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold px-3 py-2 rounded-2xl flex items-center space-x-1.5 text-xs transition-colors shadow-xs"
          >
            <Download className="w-4 h-4 text-amber-600" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>

          <button
            onClick={() => setShowEndShiftModal(true)}
            className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 rounded-2xl text-xs shadow-md transition-all"
          >
            Tutup Kasir / Shift
          </button>
        </div>
      </div>

      {/* High-Level Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Omset</span>
            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl border border-amber-200">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <span className="text-2xl font-extrabold text-slate-900 font-mono block">
            {formatRupiah(totalRevenue)}
          </span>
          <span className="text-[11px] text-emerald-600 font-semibold block">
            ↑ Penjualan Realtime
          </span>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Estimasi Profit Bersih</span>
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-200">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <span className="text-2xl font-extrabold text-emerald-600 font-mono block">
            {formatRupiah(netProfit)}
          </span>
          <span className="text-[11px] text-slate-500 block">
            Margin Bersih ~{totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0}%
          </span>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Transaksi</span>
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-200">
              <ShoppingBag className="w-5 h-5" />
            </div>
          </div>
          <span className="text-2xl font-extrabold text-slate-900 font-mono block">
            {totalOrders} Struk
          </span>
          <span className="text-[11px] text-slate-500 block">Pesanan Terkonfirmasi</span>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Rata-rata Order</span>
            <div className="p-2 bg-purple-50 text-purple-600 rounded-xl border border-purple-200">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <span className="text-2xl font-extrabold text-slate-900 font-mono block">
            {formatRupiah(avgOrderValue)}
          </span>
          <span className="text-[11px] text-slate-500 block">Nilai Per Struk (AOV)</span>
        </div>
      </div>

      {/* Visual Recharts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Hourly Sales Trend Area Chart */}
        <div className="lg:col-span-8 bg-white border border-slate-200 p-5 rounded-3xl space-y-4 shadow-xs">
          <h3 className="font-bold text-base text-slate-900 flex items-center space-x-2">
            <TrendingUp className="w-5 h-5 text-amber-600" />
            <span>Grafik Tren Penjualan Jam Ke Jam</span>
          </h3>

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
        <div className="lg:col-span-4 bg-white border border-slate-200 p-5 rounded-3xl space-y-4 shadow-xs flex flex-col justify-between">
          <h3 className="font-bold text-base text-slate-900 flex items-center space-x-2">
            <PieChartIcon className="w-5 h-5 text-indigo-600" />
            <span>Distribusi Pembayaran</span>
          </h3>

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

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {pieChartData.map((entry, idx) => (
              <div key={entry.name} className="flex items-center space-x-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                ></div>
                <span className="text-slate-700 font-semibold truncate">{entry.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top 5 Products Bar Chart */}
      <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-4 shadow-xs">
        <h3 className="font-bold text-base text-slate-900 flex items-center space-x-2">
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

      {/* Laporan HPP & Profitabilitas per Porsi (Food & Beverage) */}
      <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <h3 className="font-bold text-base text-slate-900 flex items-center space-x-2">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            <span>Laporan HPP (Harga Pokok Penjualan) & Margin Profit per Porsi</span>
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
      <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <h3 className="font-bold text-base text-slate-900 flex items-center space-x-2">
            <Clock className="w-5 h-5 text-amber-600" />
            <span>Log Sesi & Rekap Shift Kasir</span>
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            Status Kasir Saat Ini: <strong className={shift.status === 'OPEN' ? 'text-emerald-600' : 'text-rose-600'}>{shift.status === 'OPEN' ? `● AKTIF (${shift.cashierName})` : '○ DITUTUP'}</strong>
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
                className="text-slate-400 hover:text-slate-700"
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
                  className="w-full py-2.5 bg-amber-500 text-slate-950 font-bold rounded-xl text-xs font-sans hover:bg-amber-600"
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
                    className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs"
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
