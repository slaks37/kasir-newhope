import React, { useState, useMemo } from 'react';
import { usePOS } from '../../context/POSContext';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import { exportOrdersToExcel, exportOrdersToPDF } from '../../utils/reportExporter';
import { CashMovementType, CashMovementCategory, CashMovement } from '../../types';
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
  ArrowDownRight,
  ShieldAlert,
  Wallet,
  Plus,
  Trash2,
  PlusCircle,
  MinusCircle,
  ShoppingCart,
  ArrowDownCircle,
  ArrowUpCircle,
  AlertCircle,
  Sparkles,
  Tag,
  RefreshCw,
  Sliders,
  CheckCircle,
  HelpCircle,
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
  const {
    orders,
    products,
    shift,
    shiftHistory,
    endShift,
    settings,
    currentUser,
    cashMovements,
    addCashMovement,
    deleteCashMovement,
    setInitialCash,
  } = usePOS();

  // Navigation Sub-Tabs
  const [activeSubTab, setActiveSubTab] = useState<'omzet' | 'cash_ledger' | 'products' | 'shift'>('omzet');

  // Filters
  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month' | 'all'>('today');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('ALL');

  // Cash Movement Modal state
  const [showCashMovementModal, setShowCashMovementModal] = useState(false);
  const [cashType, setCashType] = useState<CashMovementType>('CASH_OUT');
  const [cashCategory, setCashCategory] = useState<CashMovementCategory>('BELANJA_BAHAN');
  const [cashAmount, setCashAmount] = useState<string>('');
  const [cashDesc, setCashDesc] = useState<string>('');
  const [cashRecipient, setCashRecipient] = useState<string>('');

  // Cash Ledger Filters
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<'ALL' | 'CASH_IN' | 'CASH_OUT'>('ALL');
  const [ledgerCategoryFilter, setLedgerCategoryFilter] = useState<string>('ALL');
  const [ledgerSearch, setLedgerSearch] = useState<string>('');

  // Set Initial Cash Modal state
  const [showInitialCashModal, setShowInitialCashModal] = useState(false);
  const [initialCashInput, setInitialCashInput] = useState<string>(String(shift.initialCash || 0));

  // End Shift Modal state
  const [showEndShiftModal, setShowEndShiftModal] = useState(false);
  const [actualCashInput, setActualCashInput] = useState<string>(String(shift.expectedCash || 0));
  const [shiftSummary, setShiftSummary] = useState<any>(null);

  // 1. TODAY'S SPECIAL METRICS (Real-time Live Omzet & Cash Flow)
  const todayMetrics = useMemo(() => {
    const now = new Date();
    const todayOrders = orders.filter((o) => {
      if (o.status !== 'COMPLETED') return false;
      return new Date(o.date).toDateString() === now.toDateString();
    });

    let todayGrossSales = 0;
    let todayDiscount = 0;
    let todayTax = 0;
    let todayNetRevenue = 0;
    let todayCashSales = 0;
    let todayQrisSales = 0;
    let todayCardSales = 0;
    let todayEWalletSales = 0;

    todayOrders.forEach((o) => {
      todayNetRevenue += o.total || 0;
      todayGrossSales += (o.subtotal || o.total) + (o.discountTotal || 0);
      todayDiscount += o.discountTotal || 0;
      todayTax += o.taxTotal || 0;

      if (o.paymentMethod === 'CASH') todayCashSales += o.total;
      else if (o.paymentMethod === 'QRIS') todayQrisSales += o.total;
      else if (o.paymentMethod === 'DEBIT' || o.paymentMethod === 'CREDIT') todayCardSales += o.total;
      else todayEWalletSales += o.total;
    });

    // Today's Cash Movements
    const todayMovements = cashMovements.filter((m) => {
      return new Date(m.timestamp).toDateString() === now.toDateString();
    });

    let todayCashIn = 0;
    let todayCashOut = 0;
    let todayExpenseBahan = 0;
    let todayExpenseOperasional = 0;
    let todayExpenseKasbon = 0;

    todayMovements.forEach((m) => {
      if (m.category === 'MODAL_AWAL') return;
      if (m.type === 'CASH_IN') {
        todayCashIn += m.amount;
      } else if (m.type === 'CASH_OUT') {
        todayCashOut += m.amount;
        if (m.category === 'BELANJA_BAHAN') todayExpenseBahan += m.amount;
        else if (m.category === 'OPERASIONAL') todayExpenseOperasional += m.amount;
        else if (m.category === 'KASBON') todayExpenseKasbon += m.amount;
      }
    });

    const expectedCashInDrawer = Math.max(0, (shift.initialCash || 0) + todayCashSales + todayCashIn - todayCashOut);
    const avgOrderValue = todayOrders.length > 0 ? Math.round(todayNetRevenue / todayOrders.length) : 0;

    return {
      totalOrders: todayOrders.length,
      todayGrossSales,
      todayDiscount,
      todayTax,
      todayNetRevenue,
      todayCashSales,
      todayQrisSales,
      todayCardSales,
      todayEWalletSales,
      todayCashIn,
      todayCashOut,
      todayExpenseBahan,
      todayExpenseOperasional,
      todayExpenseKasbon,
      initialCash: shift.initialCash || 0,
      expectedCashInDrawer,
      avgOrderValue,
    };
  }, [orders, cashMovements, shift.initialCash]);

  // 2. Filtered orders based on selected period and query
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

  // 3. Filtered Cash Movements for Ledger
  const filteredCashMovements = useMemo(() => {
    return cashMovements.filter((m) => {
      const movementDate = new Date(m.timestamp);
      const now = new Date();

      if (dateFilter === 'today') {
        if (movementDate.toDateString() !== now.toDateString()) return false;
      } else if (dateFilter === 'week') {
        const past7 = new Date();
        past7.setDate(past7.getDate() - 7);
        if (movementDate < past7) return false;
      } else if (dateFilter === 'month') {
        const past30 = new Date();
        past30.setDate(past30.getDate() - 30);
        if (movementDate < past30) return false;
      }

      if (ledgerTypeFilter !== 'ALL' && m.type !== ledgerTypeFilter) {
        return false;
      }

      if (ledgerCategoryFilter !== 'ALL' && m.category !== ledgerCategoryFilter) {
        return false;
      }

      if (ledgerSearch.trim()) {
        const q = ledgerSearch.toLowerCase();
        const matchDesc = m.description.toLowerCase().includes(q);
        const matchRecipient = m.recipientOrSource?.toLowerCase().includes(q);
        const matchCashier = m.cashierName?.toLowerCase().includes(q);
        if (!matchDesc && !matchRecipient && !matchCashier) return false;
      }

      return true;
    });
  }, [cashMovements, dateFilter, ledgerTypeFilter, ledgerCategoryFilter, ledgerSearch]);

  // Aggregated Financial Summary for Filtered Range
  const financialSummary = useMemo(() => {
    let totalGrossSales = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    let totalServiceCharge = 0;
    let totalNetRevenue = 0;
    let totalCOGS = 0;

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

  // Payment Breakdown
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

  // Cash Movement Submission Handler
  const handleSaveCashMovement = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(cashAmount.replace(/[^0-9]/g, '')) || 0;
    if (amount <= 0) {
      alert('Mohon masukkan nominal uang yang valid.');
      return;
    }
    if (!cashDesc.trim()) {
      alert('Mohon masukkan keterangan atau tujuan transaksi kas.');
      return;
    }

    addCashMovement(cashType, cashCategory, amount, cashDesc, cashRecipient);
    setShowCashMovementModal(false);
    setCashAmount('');
    setCashDesc('');
    setCashRecipient('');
  };

  // Set Initial Cash Handler
  const handleSaveInitialCash = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(initialCashInput.replace(/[^0-9]/g, '')) || 0;
    setInitialCash(amount);
    setShowInitialCashModal(false);
  };

  // Confirm End Shift Handler
  const handleConfirmEndShift = (e: React.FormEvent) => {
    e.preventDefault();
    const actual = Number(actualCashInput) || 0;
    const summary = endShift(actual);
    setShiftSummary(summary);
  };

  // Helpers for category badge labels and styling
  const getCategoryBadge = (category: CashMovementCategory) => {
    switch (category) {
      case 'MODAL_AWAL':
        return { label: 'Modal Awal', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
      case 'BELANJA_BAHAN':
        return { label: 'Belanja Bahan/Stok', color: 'bg-rose-100 text-rose-800 border-rose-300' };
      case 'OPERASIONAL':
        return { label: 'Biaya Operasional', color: 'bg-amber-100 text-amber-800 border-amber-300' };
      case 'KASBON':
        return { label: 'Kasbon Karyawan', color: 'bg-purple-100 text-purple-800 border-purple-300' };
      case 'TAMBAH_MODAL':
        return { label: 'Tambah Modal Laci', color: 'bg-sky-100 text-sky-800 border-sky-300' };
      case 'PENDAPATAN_LAIN':
        return { label: 'Pendapatan Lain', color: 'bg-teal-100 text-teal-800 border-teal-300' };
      default:
        return { label: 'Pengeluaran Lain', color: 'bg-slate-100 text-slate-800 border-slate-300' };
    }
  };

  return (
    <div className="flex-1 bg-slate-50/70 p-4 lg:p-8 overflow-y-auto space-y-6 animate-fade-in">
      {/* Header with Title, Range Selector & Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300">
              Laporan &amp; Kasir
            </span>
            <span className="text-xs text-slate-500 font-medium">
              Toko: <strong className="text-slate-800">{settings.storeName || 'New Hope POS'}</strong>
            </span>
          </div>
          <h2 className="font-black text-2xl lg:text-3xl text-slate-900 flex items-center space-x-3 mt-1">
            <BarChart3 className="w-8 h-8 text-amber-600" />
            <span>Dashboard Omzet &amp; Pembukuan Kas</span>
          </h2>
          <p className="text-xs lg:text-sm text-slate-500 mt-1 font-medium">
            Pantau omzet penjualan hari ini, log transaksi uang keluar untuk belanja bahan, uang masuk, dan modal awal laci kasir secara real-time.
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

          {/* Quick Cash Movement Buttons */}
          <button
            onClick={() => {
              setCashType('CASH_OUT');
              setCashCategory('BELANJA_BAHAN');
              setShowCashMovementModal(true);
            }}
            className="bg-rose-600 hover:bg-rose-700 text-white font-black px-3.5 py-2.5 rounded-2xl flex items-center space-x-1.5 text-xs transition-all shadow-sm active:scale-95 cursor-pointer"
            title="Catat Pengeluaran Uang Kas untuk Belanja Bahan Baku, Listrik, atau Kasbon"
          >
            <MinusCircle className="w-4 h-4 text-white" />
            <span>+ Uang Keluar (Belanja)</span>
          </button>

          <button
            onClick={() => {
              setCashType('CASH_IN');
              setCashCategory('TAMBAH_MODAL');
              setShowCashMovementModal(true);
            }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-3.5 py-2.5 rounded-2xl flex items-center space-x-1.5 text-xs transition-all shadow-sm active:scale-95 cursor-pointer"
            title="Catat Pemasukan Kas Tambahan atau Setor Modal Kasir"
          >
            <PlusCircle className="w-4 h-4 text-white" />
            <span>+ Uang Masuk</span>
          </button>

          {/* Export to Excel (.xls) Button */}
          <button
            onClick={handleExportExcel}
            className="bg-slate-800 hover:bg-slate-700 text-white font-black px-3.5 py-2.5 rounded-2xl flex items-center space-x-1.5 text-xs transition-all shadow-sm active:scale-95 cursor-pointer"
            title="Download Laporan Format Excel (.xls)"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Excel</span>
          </button>

          {/* Export to PDF / Print Button */}
          <button
            onClick={handleExportPDF}
            className="bg-slate-800 hover:bg-slate-700 text-white font-black px-3.5 py-2.5 rounded-2xl flex items-center space-x-1.5 text-xs transition-all shadow-sm active:scale-95 cursor-pointer"
            title="Cetak atau Simpan Dokumen Laporan PDF Resmi"
          >
            <Printer className="w-4 h-4 text-amber-400" />
            <span>Cetak PDF</span>
          </button>

          {/* Tutup Kasir / Shift Button */}
          <button
            onClick={() => setShowEndShiftModal(true)}
            className="bg-slate-900 hover:bg-slate-800 text-amber-400 border border-amber-500/30 font-black px-3.5 py-2.5 rounded-2xl text-xs shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            Tutup Kasir
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 🌟 HERO SECTION: DASHBOARD OMZET HARI INI & REKAP KAS FISIK DI LACI 🌟 */}
      {/* ========================================================================= */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-950 to-amber-950 text-white rounded-3xl p-6 lg:p-7 shadow-xl border border-slate-800/80 relative overflow-hidden">
        {/* Background ambient glow */}
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-5">
          {/* Top Banner Row: Live Indicator & Shift Info */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
            <div className="flex items-center space-x-3">
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
                Dashboard Omzet Hari Ini ({new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })})
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <div className="bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded-xl text-slate-300 flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-amber-400" />
                <span>Kasir: <strong className="text-white">{shift.cashierName || currentUser.name}</strong></span>
              </div>
              <div className="bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded-xl text-slate-300 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>Shift: <strong className="text-emerald-400">{shift.status === 'OPEN' ? 'SEDANG BUKA' : 'DITUTUP'}</strong></span>
              </div>
              <button
                onClick={() => setShowInitialCashModal(true)}
                className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-400/40 px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                title="Sesuaikan Modal Awal Kasir"
              >
                <Sliders className="w-3.5 h-3.5 text-amber-400" />
                <span>Ubah Modal Awal</span>
              </button>
            </div>
          </div>

          {/* 4 Core Financial Summary Cards (Today's Real-time Revenue & Cash Flow) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Omzet Penjualan Hari Ini */}
            <div className="bg-slate-800/60 backdrop-blur-xs border border-slate-700/80 rounded-2xl p-4.5 space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs font-black uppercase tracking-wider">
                <span>Omzet Penjualan Hari Ini</span>
                <div className="p-2 bg-amber-500/20 text-amber-400 rounded-xl">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl lg:text-3xl font-black text-amber-400 font-mono tracking-tight">
                {formatRupiah(todayMetrics.todayNetRevenue)}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-700/60 font-medium">
                <span>{todayMetrics.totalOrders} Transaksi Selesai</span>
                <span>AOV: {formatRupiah(todayMetrics.avgOrderValue)}</span>
              </div>
            </div>

            {/* Card 2: Modal Awal Kasir (Float) */}
            <div className="bg-slate-800/60 backdrop-blur-xs border border-slate-700/80 rounded-2xl p-4.5 space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs font-black uppercase tracking-wider">
                <span>Modal Awal Kasir</span>
                <div className="p-2 bg-sky-500/20 text-sky-400 rounded-xl">
                  <Coins className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl lg:text-3xl font-black text-sky-400 font-mono tracking-tight">
                {formatRupiah(todayMetrics.initialCash)}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-700/60 font-medium">
                <span>Kas Awal Laci</span>
                <span className="text-sky-300">Siap Kembalian</span>
              </div>
            </div>

            {/* Card 3: Log Uang Keluar (Belanja / Kasbon) */}
            <div className="bg-slate-800/60 backdrop-blur-xs border border-slate-700/80 rounded-2xl p-4.5 space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs font-black uppercase tracking-wider">
                <span>Uang Keluar / Belanja</span>
                <div className="p-2 bg-rose-500/20 text-rose-400 rounded-xl">
                  <ArrowDownRight className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl lg:text-3xl font-black text-rose-400 font-mono tracking-tight">
                - {formatRupiah(todayMetrics.todayCashOut)}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-700/60 font-medium">
                <span>Bahan: {formatRupiah(todayMetrics.todayExpenseBahan)}</span>
                <span className="text-emerald-400">+ In: {formatRupiah(todayMetrics.todayCashIn)}</span>
              </div>
            </div>

            {/* Card 4: Estimasi Kas Fisik Di Laci (Expected Cash) */}
            <div className="bg-slate-800/60 backdrop-blur-xs border border-slate-700/80 rounded-2xl p-4.5 space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs font-black uppercase tracking-wider">
                <span>Ekspektasi Kas Di Laci</span>
                <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl">
                  <Wallet className="w-4 h-4" />
                </div>
              </div>
              <div className="text-2xl lg:text-3xl font-black text-emerald-400 font-mono tracking-tight">
                {formatRupiah(todayMetrics.expectedCashInDrawer)}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-700/60 font-medium">
                <span>Modal + Tunai + In - Out</span>
                <span className="text-emerald-300 font-bold">Tunai: {formatRupiah(todayMetrics.todayCashSales)}</span>
              </div>
            </div>
          </div>

          {/* Today's Payment Method Breakdown Pill Bar */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="text-slate-400 font-bold flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-amber-400" />
              <span>Rincian Pembayaran Hari Ini:</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 font-mono">
              <div className="bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700">
                <span className="text-slate-400">💵 Tunai: </span>
                <strong className="text-emerald-400 font-bold">{formatRupiah(todayMetrics.todayCashSales)}</strong>
              </div>
              <div className="bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700">
                <span className="text-slate-400">📱 QRIS: </span>
                <strong className="text-amber-400 font-bold">{formatRupiah(todayMetrics.todayQrisSales)}</strong>
              </div>
              <div className="bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700">
                <span className="text-slate-400">💳 Kartu Debit/Kredit: </span>
                <strong className="text-indigo-400 font-bold">{formatRupiah(todayMetrics.todayCardSales)}</strong>
              </div>
              <div className="bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700">
                <span className="text-slate-400">👛 E-Wallet: </span>
                <strong className="text-purple-400 font-bold">{formatRupiah(todayMetrics.todayEWalletSales)}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs Bar */}
      <div className="bg-white border border-slate-200 p-1.5 rounded-2xl flex flex-wrap items-center justify-between gap-2 shadow-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setActiveSubTab('omzet')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'omzet'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>Dashboard Finansial &amp; Omzet ({dateFilterLabel})</span>
          </button>

          <button
            onClick={() => setActiveSubTab('cash_ledger')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'cash_ledger'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Wallet className="w-4 h-4" />
            <span>Buku Kas: Uang Keluar, Belanja &amp; Modal ({filteredCashMovements.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab('products')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'products'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Analisis Menu &amp; Profit Margin</span>
          </button>

          <button
            onClick={() => setActiveSubTab('shift')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'shift'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Rekap Sesi &amp; Shift Kasir</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SUB-TAB 1: DASHBOARD FINANSIAL & OMZET ANALYTICS */}
      {/* ========================================================================= */}
      {activeSubTab === 'omzet' && (
        <div className="space-y-6">
          {/* Primary Financial Metric Cards (5 Cards) */}
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
              <div className="text-[11px] text-slate-500 font-medium">
                Kotor: {formatRupiah(financialSummary.totalGrossSales)} | Diskon: {formatRupiah(financialSummary.totalDiscount)}
              </div>
            </div>

            {/* Total Modal Bahan Baku (COGS / HPP) */}
            <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Total Modal (HPP)</span>
                <div className="p-2.5 bg-rose-50 text-rose-600 rounded-2xl border border-rose-200">
                  <ShoppingBag className="w-5 h-5" />
                </div>
              </div>
              <span className="text-2xl font-black text-rose-700 font-mono block">
                {formatRupiah(financialSummary.totalCOGS)}
              </span>
              <div className="text-[11px] text-slate-500 font-medium">
                Biaya pokok bahan &amp; modal produk
              </div>
            </div>

            {/* Estimasi Laba Kotor & Bersih */}
            <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Estimasi Laba Bersih</span>
                <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-200">
                  <TrendingUp className="w-5 h-5" />
                </div>
              </div>
              <span className="text-2xl font-black text-emerald-700 font-mono block">
                {formatRupiah(financialSummary.grossProfit)}
              </span>
              <div className="text-[11px] text-emerald-700 font-bold">
                Margin Laba: {financialSummary.netProfitMargin}%
              </div>
            </div>

            {/* Pajak Daerah (PB1 / PPN) */}
            <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Setoran Pajak (PB1)</span>
                <div className="p-2.5 bg-sky-50 text-sky-600 rounded-2xl border border-sky-200">
                  <Building className="w-5 h-5" />
                </div>
              </div>
              <span className="text-2xl font-black text-sky-700 font-mono block">
                {formatRupiah(financialSummary.totalTax)}
              </span>
              <div className="text-[11px] text-slate-500 font-medium">
                Tarif PB1: {settings.taxRate || 10}% {settings.enableTax ? '(Aktif)' : '(Non-aktif)'}
              </div>
            </div>

            {/* Total Transaksi & AOV */}
            <div className="bg-white border border-slate-200 p-5 rounded-3xl space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Total Transaksi</span>
                <div className="p-2.5 bg-purple-50 text-purple-600 rounded-2xl border border-purple-200">
                  <Users className="w-5 h-5" />
                </div>
              </div>
              <span className="text-2xl font-black text-purple-700 font-mono block">
                {financialSummary.totalOrders} <span className="text-sm font-sans font-medium text-slate-500">Struk</span>
              </span>
              <div className="text-[11px] text-slate-500 font-medium">
                AOV: {formatRupiah(financialSummary.avgOrderValue)} / struk
              </div>
            </div>
          </div>

          {/* Charts Row: Hourly Sales Trend & Payment Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Hourly Sales Trend Area Chart (2 Cols) */}
            <div className="lg:col-span-2 bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-black text-base text-slate-900 flex items-center space-x-2">
                  <TrendingUp className="w-5 h-5 text-amber-600" />
                  <span>Tren Penjualan Per Jam ({dateFilterLabel})</span>
                </h3>
                <span className="text-xs text-slate-400 font-mono">08:00 - 22:00</span>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={areaChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="omsetGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <YAxis
                      stroke="#94a3b8"
                      fontSize={11}
                      tickLine={false}
                      tickFormatter={(val) => `Rp ${(val / 1000).toLocaleString('id-ID')}k`}
                    />
                    <Tooltip
                      formatter={(value: any) => [formatRupiah(Number(value) || 0), 'Omzet']}
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderRadius: '16px',
                        border: 'none',
                        color: '#fff',
                        fontSize: '12px',
                        fontWeight: 'bold',
                      }}
                    />
                    <Area type="monotone" dataKey="Omset" stroke="#f59e0b" strokeWidth={3} fill="url(#omsetGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Payment Methods Breakdown Pie Chart (1 Col) */}
            <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-black text-base text-slate-900 flex items-center space-x-2">
                  <PieChartIcon className="w-5 h-5 text-amber-600" />
                  <span>Distribusi Pembayaran</span>
                </h3>
              </div>
              <div className="h-64 w-full flex items-center justify-center">
                {pieChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {pieChartData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(val: any) => [formatRupiah(Number(val) || 0), 'Total']}
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderRadius: '12px',
                          color: '#fff',
                          fontSize: '11px',
                          fontWeight: 'bold',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center text-slate-400 text-xs py-8">
                    <p>Belum ada transaksi di periode ini.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Orders Transaction History Table */}
          <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="font-black text-base text-slate-900 flex items-center space-x-2">
                  <Receipt className="w-5 h-5 text-amber-600" />
                  <span>Daftar Riwayat Struk Transaksi Penjualan</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Menampilkan {filteredOrders.length} transaksi selesai pada periode {dateFilterLabel}
                </p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari ID, Pelanggan, Kasir..."
                    className="pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500 w-48 sm:w-56"
                  />
                </div>

                <select
                  value={selectedPaymentMethod}
                  onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-amber-500 cursor-pointer"
                >
                  <option value="ALL">Semua Pembayaran</option>
                  <option value="CASH">Tunai (Cash)</option>
                  <option value="QRIS">QRIS</option>
                  <option value="DEBIT">Debit</option>
                  <option value="CREDIT">Kredit</option>
                  <option value="EWALLET">E-Wallet</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-sans">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 font-extrabold uppercase text-[10px] tracking-wider">
                    <th className="py-2.5 px-3">No. Struk</th>
                    <th className="py-2.5 px-3">Waktu</th>
                    <th className="py-2.5 px-3">Kasir</th>
                    <th className="py-2.5 px-3">Pelanggan</th>
                    <th className="py-2.5 px-3">Metode</th>
                    <th className="py-2.5 px-3">HPP / Modal</th>
                    <th className="py-2.5 px-3">PB1</th>
                    <th className="py-2.5 px-3 font-mono">Total Omzet</th>
                    <th className="py-2.5 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredOrders.length > 0 ? (
                    filteredOrders.map((o) => {
                      let orderCOGS = 0;
                      o.items.forEach((item) => {
                        const prod = products.find((p) => p.id === item.productId);
                        const cost = prod ? prod.costPrice : item.unitPrice * 0.45;
                        orderCOGS += cost * item.quantity;
                      });

                      return (
                        <tr key={o.id} className="hover:bg-slate-50">
                          <td className="py-3 px-3 font-mono font-bold text-slate-900">{o.id}</td>
                          <td className="py-3 px-3 text-slate-600">{formatDateTime(o.date)}</td>
                          <td className="py-3 px-3 font-semibold text-slate-800">{o.cashierName}</td>
                          <td className="py-3 px-3 text-slate-600">{o.customer?.name || '-'}</td>
                          <td className="py-3 px-3 font-bold text-slate-800">
                            <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md text-[10px]">
                              {o.paymentMethod}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-rose-700 font-mono">{formatRupiah(orderCOGS)}</td>
                          <td className="py-3 px-3 text-sky-700 font-mono">{formatRupiah(o.taxTotal || 0)}</td>
                          <td className="py-3 px-3 font-black text-slate-900 font-mono">{formatRupiah(o.total)}</td>
                          <td className="py-3 px-3 text-right">
                            <span className="bg-emerald-100 text-emerald-800 font-extrabold text-[10px] px-2 py-0.5 rounded-full border border-emerald-200">
                              LUNAS
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400 font-medium">
                        Tidak ada transaksi penjualan yang cocok dengan filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 2: BUKU KAS & LOG TRANSAKSI UANG KELUAR, BELANJA & MODAL AWAL */}
      {/* ========================================================================= */}
      {activeSubTab === 'cash_ledger' && (
        <div className="space-y-6">
          {/* Top Cash Ledger Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Modal Awal Kasir</span>
              <span className="text-xl font-black text-sky-700 font-mono block mt-1">
                {formatRupiah(shift.initialCash || 0)}
              </span>
              <span className="text-[11px] text-slate-500 font-medium">Shift Aktif</span>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">(+) Penjualan Tunai</span>
              <span className="text-xl font-black text-emerald-700 font-mono block mt-1">
                + {formatRupiah(shift.cashSales || 0)}
              </span>
              <span className="text-[11px] text-slate-500 font-medium">Kasir Berjalan</span>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">(+) Uang Masuk Lainnya</span>
              <span className="text-xl font-black text-teal-700 font-mono block mt-1">
                + {formatRupiah(shift.totalCashIn || 0)}
              </span>
              <span className="text-[11px] text-slate-500 font-medium">Setor modal / lain</span>
            </div>

            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">(-) Uang Keluar / Belanja</span>
              <span className="text-xl font-black text-rose-700 font-mono block mt-1">
                - {formatRupiah(shift.totalCashOut || 0)}
              </span>
              <span className="text-[11px] text-slate-500 font-medium">Bahan, ops, kasbon</span>
            </div>

            <div className="bg-gradient-to-br from-amber-500 to-amber-600 text-slate-950 p-4 rounded-2xl shadow-md">
              <span className="text-[10px] font-black text-slate-900 uppercase tracking-wider block">(=) Kas Bersih Di Laci</span>
              <span className="text-xl font-black font-mono block mt-1">
                {formatRupiah(shift.expectedCash || 0)}
              </span>
              <span className="text-[11px] font-bold text-slate-900">Ekspektasi Uang Fisik</span>
            </div>
          </div>

          {/* Cash Ledger Main Box */}
          <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="font-black text-base text-slate-900 flex items-center space-x-2">
                  <Wallet className="w-5 h-5 text-amber-600" />
                  <span>Log Transaksi Kas Keluar (Belanja) &amp; Kas Masuk</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Catat pengeluaran belanja bahan harian, kasbon karyawan, biaya operasional, dan setoran modal kasir.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    setCashType('CASH_OUT');
                    setCashCategory('BELANJA_BAHAN');
                    setShowCashMovementModal(true);
                  }}
                  className="bg-rose-600 hover:bg-rose-700 text-white font-black px-3.5 py-2 rounded-xl flex items-center space-x-1.5 text-xs transition-all shadow-xs cursor-pointer"
                >
                  <MinusCircle className="w-4 h-4 text-white" />
                  <span>+ Catat Uang Keluar (Belanja)</span>
                </button>

                <button
                  onClick={() => {
                    setCashType('CASH_IN');
                    setCashCategory('TAMBAH_MODAL');
                    setShowCashMovementModal(true);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-3.5 py-2 rounded-xl flex items-center space-x-1.5 text-xs transition-all shadow-xs cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4 text-white" />
                  <span>+ Catat Uang Masuk</span>
                </button>
              </div>
            </div>

            {/* Ledger Filters Strip */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200/80">
              <div className="flex flex-wrap items-center gap-2">
                {/* Type Filter */}
                <select
                  value={ledgerTypeFilter}
                  onChange={(e) => setLedgerTypeFilter(e.target.value as any)}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-amber-500 cursor-pointer"
                >
                  <option value="ALL">Semua Jenis Kas (Masuk &amp; Keluar)</option>
                  <option value="CASH_OUT">🔴 Uang Keluar (Belanja / Operasional)</option>
                  <option value="CASH_IN">🟢 Uang Masuk (Modal / Pendapatan)</option>
                </select>

                {/* Category Filter */}
                <select
                  value={ledgerCategoryFilter}
                  onChange={(e) => setLedgerCategoryFilter(e.target.value)}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-amber-500 cursor-pointer"
                >
                  <option value="ALL">Semua Kategori</option>
                  <option value="BELANJA_BAHAN">Belanja Bahan Baku &amp; Stok</option>
                  <option value="OPERASIONAL">Biaya Operasional (Listrik/Gas/Air)</option>
                  <option value="KASBON">Kasbon Karyawan</option>
                  <option value="TAMBAH_MODAL">Tambah Modal Kasir</option>
                  <option value="MODAL_AWAL">Modal Awal Shift</option>
                  <option value="PENDAPATAN_LAIN">Pendapatan Lainnya</option>
                  <option value="PENGELUARAN_LAIN">Pengeluaran Lainnya</option>
                </select>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={ledgerSearch}
                  onChange={(e) => setLedgerSearch(e.target.value)}
                  placeholder="Cari keterangan, toko, kasir..."
                  className="pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500 w-52 sm:w-64"
                />
              </div>
            </div>

            {/* Ledger Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-sans">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 font-extrabold uppercase text-[10px] tracking-wider">
                    <th className="py-2.5 px-3">Tanggal &amp; Waktu</th>
                    <th className="py-2.5 px-3">Jenis &amp; Kategori</th>
                    <th className="py-2.5 px-3">Keterangan / Keperluan</th>
                    <th className="py-2.5 px-3">Tujuan / Sumber</th>
                    <th className="py-2.5 px-3">Petugas Kasir</th>
                    <th className="py-2.5 px-3 text-right">Nominal</th>
                    <th className="py-2.5 px-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCashMovements.length > 0 ? (
                    filteredCashMovements.map((m) => {
                      const badge = getCategoryBadge(m.category);
                      const isCashIn = m.type === 'CASH_IN';

                      return (
                        <tr key={m.id} className="hover:bg-slate-50">
                          <td className="py-3 px-3 text-slate-600 whitespace-nowrap">
                            {formatDateTime(m.timestamp)}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${badge.color}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-semibold text-slate-900">
                            {m.description}
                          </td>
                          <td className="py-3 px-3 text-slate-600">
                            {m.recipientOrSource || '-'}
                          </td>
                          <td className="py-3 px-3 text-slate-700 font-medium">
                            {m.cashierName}
                          </td>
                          <td
                            className={`py-3 px-3 text-right font-black font-mono whitespace-nowrap ${
                              isCashIn ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {isCashIn ? `+ ${formatRupiah(m.amount)}` : `- ${formatRupiah(m.amount)}`}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <button
                              onClick={() => {
                                if (confirm(`Hapus entri kas "${m.description}" (${formatRupiah(m.amount)})?`)) {
                                  deleteCashMovement(m.id);
                                }
                              }}
                              className="text-slate-400 hover:text-rose-600 p-1 rounded-lg hover:bg-rose-50 transition-all cursor-pointer"
                              title="Hapus Entri Kas"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400 font-medium">
                        <Wallet className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <p>Belum ada catatan uang keluar / belanja atau uang masuk di periode ini.</p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Gunakan tombol <strong>+ Catat Uang Keluar (Belanja)</strong> untuk mencatat pengeluaran operasional toko.
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 3: ANALISIS MENU & PROFIT MARGIN PER PRODUK */}
      {/* ========================================================================= */}
      {activeSubTab === 'products' && (
        <div className="space-y-6">
          {/* Top 5 Products Bar Chart */}
          <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-black text-base text-slate-900 flex items-center space-x-2">
                <ShoppingBag className="w-5 h-5 text-amber-600" />
                <span>Top 5 Produk Terlaris ({dateFilterLabel})</span>
              </h3>
            </div>
            <div className="h-64 w-full">
              {topProductsBarData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProductsBarData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                    <XAxis type="number" stroke="#94a3b8" fontSize={11} />
                    <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={11} width={120} tickLine={false} />
                    <Tooltip
                      formatter={(value: any) => [`${value} Porsi / Item terjual`, 'Kuantitas']}
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderRadius: '12px',
                        color: '#fff',
                        fontSize: '11px',
                        fontWeight: 'bold',
                      }}
                    />
                    <Bar dataKey="qty" fill="#f59e0b" radius={[0, 8, 8, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center text-slate-400 text-xs py-8">
                  <p>Belum ada penjualan produk pada periode ini.</p>
                </div>
              )}
            </div>
          </div>

          {/* Product Profit Margin & HPP Table */}
          <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-black text-base text-slate-900 flex items-center space-x-2">
                <Percent className="w-5 h-5 text-amber-600" />
                <span>Kalkulasi HPP, Harga Jual &amp; Margin Keuntungan Menu</span>
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 font-extrabold uppercase text-[10px] tracking-wider font-sans">
                    <th className="py-2.5 px-3">Nama Produk</th>
                    <th className="py-2.5 px-3">Harga Jual</th>
                    <th className="py-2.5 px-3">Modal Pokok (HPP)</th>
                    <th className="py-2.5 px-3">Laba Bersih Per Item</th>
                    <th className="py-2.5 px-3 text-right">Margin (%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
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
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 4: REKAP SHIFT & SESI KASIR */}
      {/* ========================================================================= */}
      {activeSubTab === 'shift' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 p-6 rounded-3xl space-y-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <h3 className="font-black text-base text-slate-900 flex items-center space-x-2">
                <Clock className="w-5 h-5 text-amber-600" />
                <span>Log Sesi &amp; Rekap Shift Kasir</span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowEndShiftModal(true)}
                  className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-3 py-1.5 rounded-xl text-xs shadow-xs cursor-pointer"
                >
                  Tutup Shift Sekarang
                </button>
                <span className="text-xs text-slate-500 font-mono">
                  Status: <strong className={shift.status === 'OPEN' ? 'text-emerald-600' : 'text-rose-600'}>{shift.status === 'OPEN' ? `● AKTIF (${shift.cashierName})` : '○ DITUTUP'}</strong>
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-sans">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400 font-extrabold uppercase text-[10px] tracking-wider">
                    <th className="py-2.5 px-3">Kasir</th>
                    <th className="py-2.5 px-3">Mulai Shift</th>
                    <th className="py-2.5 px-3">Selesai Shift</th>
                    <th className="py-2.5 px-3 font-mono">Modal Awal</th>
                    <th className="py-2.5 px-3 font-mono">Omzet Sesi</th>
                    <th className="py-2.5 px-3 font-mono">Expected Cash</th>
                    <th className="py-2.5 px-3 font-mono">Actual Cash</th>
                    <th className="py-2.5 px-3 font-mono">Selisih</th>
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
                      <td className="py-3 px-3 text-sky-700 font-bold">{formatRupiah(shift.initialCash || 0)}</td>
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
                      <td className="py-3 px-3 text-sky-700 font-bold">{formatRupiah(s.initialCash || 0)}</td>
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
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: CATAT UANG KELUAR / BELANJA & UANG MASUK */}
      {/* ========================================================================= */}
      {showCashMovementModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-lg w-full text-slate-900 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-base text-slate-900 flex items-center space-x-2">
                {cashType === 'CASH_OUT' ? (
                  <>
                    <MinusCircle className="w-5 h-5 text-rose-600" />
                    <span>Catat Uang Keluar (Belanja / Pengeluaran)</span>
                  </>
                ) : (
                  <>
                    <PlusCircle className="w-5 h-5 text-emerald-600" />
                    <span>Catat Uang Masuk (Setoran / Modal)</span>
                  </>
                )}
              </h3>
              <button
                onClick={() => setShowCashMovementModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCashMovement} className="space-y-4">
              {/* Type Switcher */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setCashType('CASH_OUT');
                    setCashCategory('BELANJA_BAHAN');
                  }}
                  className={`py-2 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    cashType === 'CASH_OUT'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ArrowDownRight className="w-4 h-4" />
                  <span>Uang Keluar (Belanja)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCashType('CASH_IN');
                    setCashCategory('TAMBAH_MODAL');
                  }}
                  className={`py-2 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    cashType === 'CASH_IN'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span>Uang Masuk (Pemasukan)</span>
                </button>
              </div>

              {/* Category Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Kategori Transaksi:</label>
                <select
                  value={cashCategory}
                  onChange={(e) => setCashCategory(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-amber-500 cursor-pointer"
                >
                  {cashType === 'CASH_OUT' ? (
                    <>
                      <option value="BELANJA_BAHAN">🛒 Belanja Bahan Baku &amp; Stok Toko</option>
                      <option value="OPERASIONAL">⚡ Biaya Operasional (Listrik / Air / Gas / Galon / Es)</option>
                      <option value="KASBON">👤 Kasbon / Uang Muka Karyawan</option>
                      <option value="PENGELUARAN_LAIN">📌 Pengeluaran Kas Lainnya</option>
                    </>
                  ) : (
                    <>
                      <option value="TAMBAH_MODAL">💼 Tambah Modal Kasir / Pecahan Uang Kecil</option>
                      <option value="MODAL_AWAL">💰 Modal Awal Buka Shift Kasir</option>
                      <option value="PENDAPATAN_LAIN">📈 Pendapatan Lain Non-Penjualan</option>
                    </>
                  )}
                </select>
              </div>

              {/* Nominal (Amount) Input with Quick Chips */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700">Nominal Uang (Rp):</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-slate-500 text-sm">Rp</span>
                  <input
                    type="number"
                    required
                    min="1000"
                    step="500"
                    placeholder="Contoh: 50000"
                    value={cashAmount}
                    onChange={(e) => setCashAmount(e.target.value)}
                    className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-base font-black text-slate-900 font-mono focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                {/* Quick Chips */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[10000, 20000, 50000, 100000, 200000, 500000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setCashAmount(String(amt))}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 active:bg-amber-100 text-slate-700 font-bold text-[11px] rounded-lg transition-all cursor-pointer font-mono"
                    >
                      {formatRupiah(amt)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Keterangan / Keperluan:</label>
                <input
                  type="text"
                  required
                  placeholder={
                    cashType === 'CASH_OUT'
                      ? 'Contoh: Beli minyak goreng 2L, es batu 5 kantong'
                      : 'Contoh: Setor uang receh kembalian dari kasir utama'
                  }
                  value={cashDesc}
                  onChange={(e) => setCashDesc(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Recipient or Store Name Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Tujuan Toko / Penerima (Opsional):</label>
                <input
                  type="text"
                  placeholder="Contoh: Pasar Baru / Toko Sembako Berkah / Mas Dian"
                  value={cashRecipient}
                  onChange={(e) => setCashRecipient(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCashMovementModal(false)}
                  className="px-4 py-2.5 bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-200 transition-all cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2.5 text-white font-black text-xs rounded-xl shadow-md transition-all cursor-pointer ${
                    cashType === 'CASH_OUT' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  Simpan Transaksi Kas
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: SESUAIKAN MODAL AWAL KASIR (FLOAT ADJUSTMENT) */}
      {/* ========================================================================= */}
      {showInitialCashModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-md w-full text-slate-900 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-base text-slate-900 flex items-center space-x-2">
                <Coins className="w-5 h-5 text-sky-600" />
                <span>Atur Modal Awal Laci Kasir</span>
              </h3>
              <button
                onClick={() => setShowInitialCashModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveInitialCash} className="space-y-4">
              <p className="text-xs text-slate-500 font-medium">
                Modal awal adalah kas fisik yang sudah ada di dalam laci kasir saat buka shift (sebagai uang kembalian).
              </p>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700">Nominal Modal Awal (Rp):</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-slate-500 text-sm">Rp</span>
                  <input
                    type="number"
                    required
                    min="0"
                    step="1000"
                    value={initialCashInput}
                    onChange={(e) => setInitialCashInput(e.target.value)}
                    className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black text-sky-700 font-mono focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[0, 50000, 100000, 200000, 300000, 500000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setInitialCashInput(String(amt))}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-lg transition-all cursor-pointer font-mono"
                    >
                      {formatRupiah(amt)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowInitialCashModal(false)}
                  className="px-4 py-2.5 bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-200 transition-all cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-black text-xs rounded-xl shadow-md transition-all cursor-pointer"
                >
                  Perbarui Modal Awal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: TUTUP KASIR / REKAP SHIFT RECONCILIATION */}
      {/* ========================================================================= */}
      {showEndShiftModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-md w-full text-slate-900 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-base text-rose-600 flex items-center space-x-2">
                <Clock className="w-5 h-5" />
                <span>Tutup Kasir / Rekap Shift</span>
              </h3>
              <button
                onClick={() => setShowEndShiftModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer p-1 rounded-lg hover:bg-slate-100"
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
                    <span>Penjualan Tunai (+):</span>
                    <span>{formatRupiah(shiftSummary.cashSales)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Kas Masuk Lainnya (+):</span>
                    <span>{formatRupiah(shiftSummary.totalCashIn || 0)}</span>
                  </div>
                  <div className="flex justify-between text-rose-600">
                    <span>Uang Keluar / Belanja (-):</span>
                    <span>- {formatRupiah(shiftSummary.totalCashOut || 0)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Non-Tunai (QRIS/Card/E-Wallet):</span>
                    <span>{formatRupiah((shiftSummary.qrisSales || 0) + (shiftSummary.cardSales || 0) + (shiftSummary.eWalletSales || 0))}</span>
                  </div>
                  <div className="flex justify-between font-bold text-amber-700 pt-1 border-t border-slate-200">
                    <span>Ekspektasi Kas Fisik Laci:</span>
                    <span>{formatRupiah(shiftSummary.expectedCash)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-slate-900">
                    <span>Fisik Kas Dihitung:</span>
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
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Modal Awal:</span>
                    <span className="font-mono">{formatRupiah(shift.initialCash || 0)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Total Penjualan Tunai (+):</span>
                    <span className="font-mono">{formatRupiah(shift.cashSales || 0)}</span>
                  </div>
                  <div className="flex justify-between text-teal-700">
                    <span>Uang Masuk Tambahan (+):</span>
                    <span className="font-mono">+ {formatRupiah(shift.totalCashIn || 0)}</span>
                  </div>
                  <div className="flex justify-between text-rose-700">
                    <span>Uang Keluar / Belanja (-):</span>
                    <span className="font-mono">- {formatRupiah(shift.totalCashOut || 0)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-amber-700 pt-1.5 border-t border-slate-200">
                    <span>Ekspektasi Uang Fisik Di Laci:</span>
                    <span className="font-mono">{formatRupiah(shift.expectedCash || 0)}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
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
                    className="px-4 py-2.5 bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-200 transition-all cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
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
