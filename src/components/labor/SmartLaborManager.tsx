import React, { useState, useMemo } from 'react';
import { usePOS } from '../../context/POSContext';
import {
  Users,
  Coins,
  TrendingUp,
  Award,
  Calendar,
  DollarSign,
  Printer,
  Share2,
  CheckCircle2,
  Trash2,
  Settings2,
  FileText,
  AlertCircle,
  Scissors,
  Car,
  UtensilsCrossed,
  Sparkles,
  ShoppingBag,
  ExternalLink,
  Percent,
  Calculator,
  Plus,
  ArrowRight,
  ShieldCheck,
  Building2,
} from 'lucide-react';
import { formatRupiah, formatDateOnly, formatDateTime } from '../../utils/formatters';
import {
  calculateSmartLaborMetrics,
  createPayrollSlipForStaff,
  formatWhatsAppPayrollText,
  StaffPerformanceMetric,
} from '../../utils/commissionEngine';
import { PayrollSlip, StaffCommissionRule, BusinessSector } from '../../types';

export const SmartLaborManager: React.FC = () => {
  const {
    staffMembers,
    attendanceLogs,
    orders,
    bookings,
    commissionRules,
    saveCommissionRule,
    payrollSlips,
    savePayrollSlip,
    deletePayrollSlip,
    disbursePayrollCashMovement,
    settings,
  } = usePOS();

  const sector: BusinessSector = settings.businessSector || 'FNB';

  // Date Range State (default to current month)
  const [dateFilterMode, setDateFilterMode] = useState<'THIS_MONTH' | 'LAST_7_DAYS' | 'TODAY' | 'CUSTOM'>('THIS_MONTH');

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const currentMonthStartStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }, []);

  const [startDate, setStartDate] = useState<string>(currentMonthStartStr);
  const [endDate, setEndDate] = useState<string>(todayStr);

  const handleDateFilterChange = (mode: 'THIS_MONTH' | 'LAST_7_DAYS' | 'TODAY' | 'CUSTOM') => {
    setDateFilterMode(mode);
    const now = new Date();
    if (mode === 'TODAY') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (mode === 'LAST_7_DAYS') {
      const past = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      setStartDate(past.toISOString().slice(0, 10));
      setEndDate(todayStr);
    } else if (mode === 'THIS_MONTH') {
      setStartDate(currentMonthStartStr);
      setEndDate(todayStr);
    }
  };

  // Active Tab
  const [activeSubTab, setActiveSubTab] = useState<'rekap' | 'aturan' | 'slip'>('rekap');

  // Modal State for Generating/Editing a Slip
  const [selectedStaffForSlip, setSelectedStaffForSlip] = useState<StaffPerformanceMetric | null>(null);
  const [slipDeductions, setSlipDeductions] = useState<number>(0);
  const [slipNotes, setSlipNotes] = useState<string>('');

  // Modal State for Slip View & Print
  const [viewingSlip, setViewingSlip] = useState<PayrollSlip | null>(null);
  const [thermalPaperSize, setThermalPaperSize] = useState<'58mm' | '80mm'>('80mm');

  // Rule Form State
  const activeSectorRule = useMemo(() => {
    return (
      commissionRules.find((r) => r.staffId === 'GLOBAL_SECTOR' || r.staffId === sector) ||
      commissionRules[0] || {
        staffId: 'GLOBAL_SECTOR',
        serviceCommissionPercent: sector === 'BARBERSHOP' ? 35 : 0,
        fixedCommissionPerService: sector === 'BARBERSHOP' ? 15000 : 0,
        retailCommissionPercent: sector === 'BARBERSHOP' ? 10 : 5,
        teamPoolType: 'PERCENTAGE_OF_POOL',
        teamPoolRate: sector === 'CARWASH' ? 20 : 0,
        teamPoolDistribution: 'BY_ASSIGNED_JOB',
        dailyRevenueTarget: sector === 'FNB' ? 2500000 : 3000000,
        targetBonusAmount: 50000,
        targetStretchAmount: 5000000,
        targetStretchBonus: 100000,
        targetBonusType: 'FLAT_PER_STAFF',
      }
    );
  }, [commissionRules, sector]);

  const [ruleForm, setRuleForm] = useState<StaffCommissionRule>({ ...activeSectorRule });
  const [ruleSaveSuccess, setRuleSaveSuccess] = useState<boolean>(false);

  // Compute live labor metrics
  const laborSummary = useMemo(() => {
    return calculateSmartLaborMetrics({
      staffMembers,
      attendanceRecords: attendanceLogs,
      orders,
      bookings,
      rules: commissionRules,
      sector,
      startDate,
      endDate,
    });
  }, [staffMembers, attendanceLogs, orders, bookings, commissionRules, sector, startDate, endDate]);

  // Sector Badge & Explainer
  const sectorMeta = useMemo(() => {
    switch (sector) {
      case 'BARBERSHOP':
        return {
          title: 'Barbershop: Komisi Per-Kepala Kapster',
          badge: 'Kapster & Stylist Mode',
          icon: Scissors,
          color: 'text-indigo-600 bg-indigo-50 border-indigo-200',
          desc: 'Komisi langsung dihitung per kepala potong rambut / layanan dan persentase up-sell produk styling (pomade, tonic).',
        };
      case 'CARWASH':
        return {
          title: 'Car Wash: Bagi Hasil Tim Cuci',
          badge: 'Team Pool & Job Split',
          icon: Car,
          color: 'text-sky-600 bg-sky-50 border-sky-200',
          desc: 'Bagi hasil tim otomatis dari omzet pencucian kendaraan, dibagi rata atau sesuai kru cuci yang terdata di plat antrean.',
        };
      case 'FNB':
        return {
          title: 'F&B: Insentif Target Omzet Harian',
          badge: 'Daily Revenue Target',
          icon: UtensilsCrossed,
          color: 'text-amber-600 bg-amber-50 border-amber-200',
          desc: 'Insentif otomatis bila omzet restoran tembus target harian atau stretch goal, dibagikan ke staf yang hadir/clock-in.',
        };
      case 'LAUNDRY':
        return {
          title: 'Laundry: Komisi Layanan & Target',
          badge: 'Production & Service Pool',
          icon: Sparkles,
          color: 'text-cyan-600 bg-cyan-50 border-cyan-200',
          desc: 'Insentif berbasis penyelesaian pesanan laundry kiloan/satuan dan bonus tim jika target harian terpenuhi.',
        };
      case 'RETAIL':
      default:
        return {
          title: 'Retail: Komisi Penjualan & Target Toko',
          badge: 'Retail Sales Commission',
          icon: ShoppingBag,
          color: 'text-emerald-600 bg-emerald-50 border-emerald-200',
          desc: 'Komisi sales per transaksi kasir ditambah bonus target omzet harian toko bagi seluruh pramuniaga yang bertugas.',
        };
    }
  }, [sector]);

  // Handle Save Rule Form
  const handleSaveRule = (e: React.FormEvent) => {
    e.preventDefault();
    saveCommissionRule({
      ...ruleForm,
      staffId: 'GLOBAL_SECTOR',
    });
    setRuleSaveSuccess(true);
    setTimeout(() => setRuleSaveSuccess(false), 3000);
  };

  // Open Slip Creator Modal
  const handleOpenSlipModal = (metric: StaffPerformanceMetric) => {
    setSelectedStaffForSlip(metric);
    setSlipDeductions(0);
    setSlipNotes('');
  };

  // Generate Slip
  const handleConfirmGenerateSlip = () => {
    if (!selectedStaffForSlip) return;
    const periodMonth = startDate.slice(0, 7);
    const slip = createPayrollSlipForStaff(
      selectedStaffForSlip,
      periodMonth,
      startDate,
      endDate,
      sector,
      slipDeductions,
      slipNotes
    );
    savePayrollSlip(slip);
    setSelectedStaffForSlip(null);
    setViewingSlip(slip);
    setActiveSubTab('slip');
  };

  // Send WhatsApp directly
  const handleShareWhatsApp = (slip: PayrollSlip) => {
    const text = formatWhatsAppPayrollText(slip, settings.storeName);
    const staff = staffMembers.find((s) => s.id === slip.staffId);
    const phone = staff?.phone?.replace(/\D/g, '') || '';
    const cleanPhone = phone.startsWith('0') ? '62' + phone.slice(1) : phone;
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  // Disburse Cash Out
  const handleDisbursePayroll = (slip: PayrollSlip) => {
    const confirmMsg = `Cairkan gaji bersih ${formatRupiah(slip.netSalary)} untuk ${slip.staffName}? Pembayaran akan dicatat otomatis di Buku Kas sebagai Pengeluaran Operasional.`;
    if (window.confirm(confirmMsg)) {
      disbursePayrollCashMovement(slip.id, 'TUNAI / KAS');
      if (viewingSlip && viewingSlip.id === slip.id) {
        setViewingSlip({
          ...viewingSlip,
          status: 'PAID',
          paidAt: new Date().toISOString(),
          paymentMethod: 'TUNAI / KAS',
        });
      }
    }
  };

  const SectorIcon = sectorMeta.icon;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Sector Banner & Title */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${sectorMeta.color}`}>
              <SectorIcon className="w-3.5 h-3.5" />
              {sectorMeta.badge}
            </span>
            <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              {settings.storeName}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            Smart Labor & Commission Core
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl">{sectorMeta.desc}</p>
        </div>

        {/* Date Filter Toolbar */}
        <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-2 rounded-2xl border border-slate-200">
          <div className="flex items-center gap-1 text-xs font-bold text-slate-700">
            <Calendar className="w-4 h-4 text-slate-500" />
            <span>Periode:</span>
          </div>
          <button
            type="button"
            onClick={() => handleDateFilterChange('THIS_MONTH')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              dateFilterMode === 'THIS_MONTH'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            Bulan Ini
          </button>
          <button
            type="button"
            onClick={() => handleDateFilterChange('LAST_7_DAYS')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              dateFilterMode === 'LAST_7_DAYS'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            7 Hari
          </button>
          <button
            type="button"
            onClick={() => handleDateFilterChange('TODAY')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              dateFilterMode === 'TODAY'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            Hari Ini
          </button>
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setDateFilterMode('CUSTOM');
                setStartDate(e.target.value);
              }}
              className="px-2 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-800"
            />
            <span className="text-xs text-slate-400">-</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setDateFilterMode('CUSTOM');
                setEndDate(e.target.value);
              }}
              className="px-2 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-800"
            />
          </div>
        </div>
      </div>

      {/* 4 Summary Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Labor Expense */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Total Beban Gaji & Komisi</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">
            {formatRupiah(laborSummary.totalLaborExpense)}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
            <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
              {laborSummary.laborToRevenueRatioPercent}%
            </span>
            <span>dari omzet periode ({formatRupiah(laborSummary.totalRevenueInPeriod)})</span>
          </div>
        </div>

        {/* Total Commission Expense */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Komisi & Bagi Hasil</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-600">
            {formatRupiah(laborSummary.totalCommissionExpense)}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Komisi individu/layanan + bagi hasil tim
          </div>
        </div>

        {/* Total Target Bonus */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Bonus Target Omzet</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Award className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-amber-600">
            {formatRupiah(laborSummary.totalBonusExpense)}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {laborSummary.dailyTargetAchievements.length} hari tembus target omzet
          </div>
        </div>

        {/* Staff Headcount */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Staf Terdata ({sector})</span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">
            {laborSummary.staffMetrics.length} Staf
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Gaji pokok & tunjangan: {formatRupiah(laborSummary.totalBaseExpense)}
          </div>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex border-b border-slate-200 space-x-2">
        <button
          type="button"
          onClick={() => setActiveSubTab('rekap')}
          className={`pb-3 px-4 font-bold text-sm flex items-center gap-2 border-b-2 transition-all ${
            activeSubTab === 'rekap'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>Rekap Kinerja & Komisi Staf</span>
          <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-xs">
            {laborSummary.staffMetrics.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('aturan')}
          className={`pb-3 px-4 font-bold text-sm flex items-center gap-2 border-b-2 transition-all ${
            activeSubTab === 'aturan'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Settings2 className="w-4 h-4" />
          <span>Aturan Komisi & Target Fleksibel</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('slip')}
          className={`pb-3 px-4 font-bold text-sm flex items-center gap-2 border-b-2 transition-all ${
            activeSubTab === 'slip'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Slip Gaji & Pencairan Kas</span>
          <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full text-xs font-extrabold">
            {payrollSlips.length}
          </span>
        </button>
      </div>

      {/* TAB 1: REKAP KINERJA & KOMISI STAF */}
      {activeSubTab === 'rekap' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
            <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Tabel Akumulasi Pendapatan & Komisi Staf</h3>
                <p className="text-xs text-slate-500">
                  Dihitung otomatis dari log kehadiran, order terselesaikan, dan pembagian insentif {sectorMeta.badge}.
                </p>
              </div>
            </div>

            {laborSummary.staffMetrics.length === 0 ? (
              <div className="p-12 text-center text-slate-500 space-y-3">
                <Users className="w-12 h-12 mx-auto text-slate-300" />
                <p className="font-bold text-slate-700">Belum Ada Staf di Sektor Ini</p>
                <p className="text-xs text-slate-500">
                  Tambahkan staf baru di menu Pengaturan Pengguna / Staff Roster untuk sektor {sector}.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-600 text-xs uppercase font-extrabold">
                      <th className="py-3 px-4">Nama Staf & Role</th>
                      <th className="py-3 px-4 text-center">Kehadiran</th>
                      <th className="py-3 px-4 text-center">
                        {sector === 'BARBERSHOP' ? 'Kepala Cukur' : sector === 'CARWASH' ? 'Mobil / Cuci' : 'Pesanan'}
                      </th>
                      <th className="py-3 px-4 text-right">Gaji & Tunjangan</th>
                      <th className="py-3 px-4 text-right">Komisi Layanan</th>
                      <th className="py-3 px-4 text-right">Bagi Hasil Tim</th>
                      <th className="py-3 px-4 text-right">Bonus Target</th>
                      <th className="py-3 px-4 text-right font-black text-slate-900">Total Kotor</th>
                      <th className="py-3 px-4 text-center">Aksi Slip Gaji</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {laborSummary.staffMetrics.map((m) => (
                      <tr key={m.staffId} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-800 font-bold flex items-center justify-center shrink-0">
                              {m.staffName.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-bold text-slate-900">{m.staffName}</div>
                              <div className="text-xs text-slate-500">{m.staffRole}</div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <span className="px-2.5 py-1 bg-slate-100 text-slate-800 rounded-lg text-xs font-bold">
                            {m.daysAttended} Hari
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <span className="font-bold text-slate-800">{m.totalServiceCount}</span>
                          {m.totalServiceSales > 0 && (
                            <div className="text-[10px] text-slate-400">
                              {formatRupiah(m.totalServiceSales)}
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="font-semibold text-slate-800">
                            {formatRupiah(m.baseSalaryPayable + m.allowancePayable)}
                          </div>
                          {m.allowancePayable > 0 && (
                            <div className="text-[10px] text-slate-400">
                              U.Makan: {formatRupiah(m.allowancePayable)}
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right font-semibold text-emerald-600">
                          {m.individualCommission > 0 ? formatRupiah(m.individualCommission) : '-'}
                        </td>

                        <td className="py-3.5 px-4 text-right font-semibold text-sky-600">
                          {m.teamPoolCommission > 0 ? formatRupiah(m.teamPoolCommission) : '-'}
                        </td>

                        <td className="py-3.5 px-4 text-right font-semibold text-amber-600">
                          {m.dailyTargetBonus > 0 ? formatRupiah(m.dailyTargetBonus) : '-'}
                        </td>

                        <td className="py-3.5 px-4 text-right font-black text-slate-900">
                          {formatRupiah(m.grossPayable)}
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <button
                            type="button"
                            onClick={() => handleOpenSlipModal(m)}
                            className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 shadow-2xs"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Buat Slip</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Daily Target Achievement Breakdown if applicable */}
          {laborSummary.dailyTargetAchievements.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-500" />
                  <span>Daftar Hari Tembus Target Omzet ({laborSummary.dailyTargetAchievements.length} Hari)</span>
                </h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {laborSummary.dailyTargetAchievements.map((ach) => (
                  <div key={ach.date} className="p-3.5 bg-amber-50/50 border border-amber-200 rounded-2xl space-y-1.5 text-xs">
                    <div className="flex items-center justify-between font-bold text-slate-900">
                      <span>{formatDateOnly(ach.date)}</span>
                      <span className="px-2 py-0.5 rounded-md bg-amber-200 text-amber-900 font-extrabold text-[10px]">
                        {ach.isStretchAchieved ? 'STRETCH TARGET' : 'TARGET TERCAPAI'}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Omzet: {formatRupiah(ach.revenue)}</span>
                      <span>Target: {formatRupiah(ach.target)}</span>
                    </div>
                    <div className="text-amber-800 font-bold">
                      Bonus: {formatRupiah(ach.bonusAmount)} / staf hadir
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">
                      Penerima: {ach.eligibleStaffNames.join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ATURAN KOMISI & TARGET FLEKSIBEL */}
      {activeSubTab === 'aturan' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-6">
          <div>
            <h3 className="font-bold text-slate-900 text-lg">Konfigurasi Aturan Komisi & Insentif</h3>
            <p className="text-xs text-slate-500">
              Sesuaikan model komisi agar selaras dengan kultur industri usaha Anda. Aturan ini berlaku untuk perhitungan komisi staf sektor {sector}.
            </p>
          </div>

          {ruleSaveSuccess && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-2 text-emerald-800 text-xs font-bold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Aturan komisi dan insentif berhasil diperbarui dan disimpan!</span>
            </div>
          )}

          <form onSubmit={handleSaveRule} className="space-y-6">
            {/* Mode 1: Individual / Barbershop Per-Head */}
            <div className="p-5 border border-slate-200 rounded-2xl bg-slate-50/50 space-y-4">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <Scissors className="w-4 h-4 text-indigo-600" />
                <span>1. Komisi Layanan Individu / Per-Kepala (Cocok untuk Barbershop / Salon)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Persentase Komisi Jasa (%)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={ruleForm.serviceCommissionPercent || 0}
                      onChange={(e) =>
                        setRuleForm({
                          ...ruleForm,
                          serviceCommissionPercent: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900 pr-8"
                      min={0}
                      max={100}
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-bold">%</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Cth: 30% atau 35% dari nilai jasa potong</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Atau Flat Rp per Layanan/Kepala
                  </label>
                  <input
                    type="number"
                    value={ruleForm.fixedCommissionPerService || 0}
                    onChange={(e) =>
                      setRuleForm({
                        ...ruleForm,
                        fixedCommissionPerService: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900"
                    placeholder="15000"
                    min={0}
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Cth: Rp 15.000 / kepala jika flat</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Komisi Up-sell Produk Retail (%)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={ruleForm.retailCommissionPercent || 0}
                      onChange={(e) =>
                        setRuleForm({
                          ...ruleForm,
                          retailCommissionPercent: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900 pr-8"
                      min={0}
                      max={100}
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-bold">%</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Cth: 5% - 10% dari penjualan pomade / produk</p>
                </div>
              </div>
            </div>

            {/* Mode 2: Car Wash / Team Pooled Split */}
            <div className="p-5 border border-slate-200 rounded-2xl bg-slate-50/50 space-y-4">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <Car className="w-4 h-4 text-sky-600" />
                <span>2. Bagi Hasil Tim Cuci (Cocok untuk Car Wash)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Tipe Pool Bagi Hasil
                  </label>
                  <select
                    value={ruleForm.teamPoolType || 'PERCENTAGE_OF_POOL'}
                    onChange={(e) =>
                      setRuleForm({
                        ...ruleForm,
                        teamPoolType: e.target.value as any,
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900"
                  >
                    <option value="PERCENTAGE_OF_POOL">Persentase dari Omzet Cuci (%)</option>
                    <option value="FIXED_PER_VEHICLE">Flat Rupiah per Kendaraan Dicuci</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Nilai Rate Pool ({ruleForm.teamPoolType === 'FIXED_PER_VEHICLE' ? 'Rp' : '%'})
                  </label>
                  <input
                    type="number"
                    value={ruleForm.teamPoolRate || 0}
                    onChange={(e) =>
                      setRuleForm({
                        ...ruleForm,
                        teamPoolRate: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900"
                    placeholder="20"
                    min={0}
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Cth: 20% dari omzet cuci atau Rp 10.000/mobil</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Metode Pembagian Tim
                  </label>
                  <select
                    value={ruleForm.teamPoolDistribution || 'BY_ASSIGNED_JOB'}
                    onChange={(e) =>
                      setRuleForm({
                        ...ruleForm,
                        teamPoolDistribution: e.target.value as any,
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900"
                  >
                    <option value="BY_ASSIGNED_JOB">Bagi Antar Kru yang Ditugaskan ke Plat Mobil</option>
                    <option value="EQUAL_AMONG_PRESENT">Bagi Rata ke Seluruh Staf Hadir Hari Itu</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Mode 3: F&B / Retail Daily Revenue Target Incentive */}
            <div className="p-5 border border-slate-200 rounded-2xl bg-slate-50/50 space-y-4">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <UtensilsCrossed className="w-4 h-4 text-amber-600" />
                <span>3. Insentif Target Omzet Harian (Cocok untuk Resto / Cafe / Retail)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Target Omzet Harian (Rp)
                  </label>
                  <input
                    type="number"
                    value={ruleForm.dailyRevenueTarget || 0}
                    onChange={(e) =>
                      setRuleForm({
                        ...ruleForm,
                        dailyRevenueTarget: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900"
                    placeholder="2500000"
                    min={0}
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Cth: Rp 2.500.000 per hari</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Bonus Capai Target (Rp / Staf)
                  </label>
                  <input
                    type="number"
                    value={ruleForm.targetBonusAmount || 0}
                    onChange={(e) =>
                      setRuleForm({
                        ...ruleForm,
                        targetBonusAmount: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900"
                    placeholder="50000"
                    min={0}
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Diberikan ke setiap staf yang hadir</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Target Stretch / Ambisius (Rp)
                  </label>
                  <input
                    type="number"
                    value={ruleForm.targetStretchAmount || 0}
                    onChange={(e) =>
                      setRuleForm({
                        ...ruleForm,
                        targetStretchAmount: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900"
                    placeholder="5000000"
                    min={0}
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Cth: Rp 5.000.000 jika omzet ramai</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Bonus Stretch (Rp / Staf)
                  </label>
                  <input
                    type="number"
                    value={ruleForm.targetStretchBonus || 0}
                    onChange={(e) =>
                      setRuleForm({
                        ...ruleForm,
                        targetStretchBonus: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900"
                    placeholder="100000"
                    min={0}
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Jika target stretch tercapai</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-all shadow-md flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Simpan Perubahan Aturan Komisi</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 3: SLIP GAJI & PENCAIRAN KAS */}
      {activeSubTab === 'slip' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
            <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Arsip Slip Gaji & Payroll Center</h3>
                <p className="text-xs text-slate-500">
                  Daftar slip gaji resmi yang siap dicetak ke printer thermal, dikirim via WhatsApp, atau dicairkan langsung dari kas toko.
                </p>
              </div>
            </div>

            {payrollSlips.length === 0 ? (
              <div className="p-12 text-center text-slate-500 space-y-3">
                <FileText className="w-12 h-12 mx-auto text-slate-300" />
                <p className="font-bold text-slate-700">Belum Ada Slip Gaji yang Dibuat</p>
                <p className="text-xs text-slate-500">
                  Buka tab &quot;Rekap Kinerja &amp; Komisi Staf&quot; lalu klik tombol &quot;Buat Slip&quot; untuk menghasilkan slip gaji staf.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-600 text-xs uppercase font-extrabold">
                      <th className="py-3 px-4">No Slip & Staf</th>
                      <th className="py-3 px-4 text-center">Periode</th>
                      <th className="py-3 px-4 text-right">Penghasilan Kotor</th>
                      <th className="py-3 px-4 text-right">Potongan</th>
                      <th className="py-3 px-4 text-right font-black text-slate-900">Gaji Bersih (THP)</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {payrollSlips.map((slip) => (
                      <tr key={slip.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900">{slip.staffName}</div>
                          <div className="text-xs text-slate-400 font-mono">{slip.id}</div>
                        </td>

                        <td className="py-3.5 px-4 text-center text-xs text-slate-600">
                          <div>{slip.periodMonth}</div>
                          <div className="text-[10px] text-slate-400">
                            {formatDateOnly(slip.periodStart)} - {formatDateOnly(slip.periodEnd)}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-right text-slate-800">
                          {formatRupiah(slip.grossEarnings)}
                        </td>

                        <td className="py-3.5 px-4 text-right text-rose-600">
                          {slip.deductions > 0 ? `-${formatRupiah(slip.deductions)}` : '-'}
                        </td>

                        <td className="py-3.5 px-4 text-right font-black text-slate-900 text-base">
                          {formatRupiah(slip.netSalary)}
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          {slip.status === 'PAID' ? (
                            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-extrabold border border-emerald-200 inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>LUNAS</span>
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-extrabold border border-amber-200 inline-flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5" />
                              <span>DRAFT</span>
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {/* View & Print Slip */}
                            <button
                              type="button"
                              onClick={() => setViewingSlip(slip)}
                              title="Cetak Struk Thermal"
                              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                            >
                              <Printer className="w-4 h-4" />
                            </button>

                            {/* Share WhatsApp */}
                            <button
                              type="button"
                              onClick={() => handleShareWhatsApp(slip)}
                              title="Kirim Slip via WhatsApp"
                              className="p-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-colors"
                            >
                              <Share2 className="w-4 h-4" />
                            </button>

                            {/* Disburse if draft */}
                            {slip.status !== 'PAID' && (
                              <button
                                type="button"
                                onClick={() => handleDisbursePayroll(slip)}
                                title="Cairkan Kas Keluar"
                                className="px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors flex items-center gap-1"
                              >
                                <DollarSign className="w-3.5 h-3.5" />
                                <span>Bayar</span>
                              </button>
                            )}

                            {/* Delete */}
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm('Hapus slip gaji ini?')) {
                                  deletePayrollSlip(slip.id);
                                }
                              }}
                              title="Hapus Slip"
                              className="p-2 rounded-xl text-slate-400 hover:text-rose-600 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 1: CREATE / DRAFT SLIP GAJI */}
      {selectedStaffForSlip && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Buat Slip Gaji Resmi</h3>
                <p className="text-xs text-slate-500">
                  {selectedStaffForSlip.staffName} ({selectedStaffForSlip.staffRole}) • Periode {startDate} s/d {endDate}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStaffForSlip(null)}
                className="text-slate-400 hover:text-slate-700 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            {/* Income Breakdown Card */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs">
              <div className="font-bold text-slate-800 text-sm border-b border-slate-200 pb-1.5">
                Rincian Akumulasi Pendapatan:
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Hari Masuk / Hadir:</span>
                <span className="font-bold text-slate-900">{selectedStaffForSlip.daysAttended} Hari</span>
              </div>
              {selectedStaffForSlip.baseSalaryPayable > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Gaji Pokok:</span>
                  <span className="font-bold text-slate-900">{formatRupiah(selectedStaffForSlip.baseSalaryPayable)}</span>
                </div>
              )}
              {selectedStaffForSlip.allowancePayable > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Uang Makan / Transport:</span>
                  <span className="font-bold text-slate-900">{formatRupiah(selectedStaffForSlip.allowancePayable)}</span>
                </div>
              )}
              {selectedStaffForSlip.individualCommission > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Komisi Layanan &amp; Retail:</span>
                  <span className="font-bold">{formatRupiah(selectedStaffForSlip.individualCommission)}</span>
                </div>
              )}
              {selectedStaffForSlip.teamPoolCommission > 0 && (
                <div className="flex justify-between text-sky-700">
                  <span>Bagi Hasil Tim Cuci:</span>
                  <span className="font-bold">{formatRupiah(selectedStaffForSlip.teamPoolCommission)}</span>
                </div>
              )}
              {selectedStaffForSlip.dailyTargetBonus > 0 && (
                <div className="flex justify-between text-amber-700">
                  <span>Bonus Target Omzet Harian:</span>
                  <span className="font-bold">{formatRupiah(selectedStaffForSlip.dailyTargetBonus)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-slate-900 text-sm pt-2 border-t border-slate-200">
                <span>Total Penghasilan Kotor:</span>
                <span>{formatRupiah(selectedStaffForSlip.grossPayable)}</span>
              </div>
            </div>

            {/* Deductions & Notes */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Potongan / Pelunasan Kasbon (Rp)
                </label>
                <input
                  type="number"
                  value={slipDeductions}
                  onChange={(e) => setSlipDeductions(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900"
                  placeholder="0"
                  min={0}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Catatan Tambahan
                </label>
                <input
                  type="text"
                  value={slipNotes}
                  onChange={(e) => setSlipNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-900"
                  placeholder="Cth: Bonus performa bulanan / Pelunasan kasbon"
                />
              </div>

              {/* Net Salary Preview */}
              <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-2xl flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-blue-900">Total Gaji Bersih (Take Home Pay)</div>
                  <div className="text-[10px] text-blue-600">Kotor dikurangi potongan</div>
                </div>
                <div className="text-xl font-black text-blue-700">
                  {formatRupiah(Math.max(0, selectedStaffForSlip.grossPayable - slipDeductions))}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedStaffForSlip(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmGenerateSlip}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Simpan Slip Gaji</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: VIEW & THERMAL PRINT SLIP GAJI */}
      {viewingSlip && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Cetak Slip Gaji Termal</h3>
                  <p className="text-[10px] text-slate-500">Format struk kasir termal {thermalPaperSize}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => setThermalPaperSize('58mm')}
                    className={`px-2 py-0.5 rounded-md ${thermalPaperSize === '58mm' ? 'bg-white shadow-2xs text-blue-700' : 'text-slate-500'}`}
                  >
                    58mm
                  </button>
                  <button
                    type="button"
                    onClick={() => setThermalPaperSize('80mm')}
                    className={`px-2 py-0.5 rounded-md ${thermalPaperSize === '80mm' ? 'bg-white shadow-2xs text-blue-700' : 'text-slate-500'}`}
                  >
                    80mm
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setViewingSlip(null)}
                  className="text-slate-400 hover:text-slate-700 font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Thermal Struk Preview Box */}
            <div className="flex-1 overflow-y-auto p-4 bg-slate-50 border border-slate-200 rounded-2xl font-mono text-xs text-slate-800 space-y-2">
              <div className="text-center space-y-0.5 border-b border-dashed border-slate-300 pb-2">
                <div className="font-black text-sm uppercase">{settings.storeName}</div>
                <div className="text-[10px] text-slate-500">{settings.address || 'Smart POS Labor & Commission'}</div>
                <div className="text-[10px] font-bold">SLIP GAJI &amp; KOMISI STAF</div>
              </div>

              <div className="text-[11px] space-y-0.5 border-b border-dashed border-slate-300 pb-2">
                <div className="flex justify-between">
                  <span>No. Slip:</span>
                  <span className="font-bold">{viewingSlip.id.slice(0, 18)}...</span>
                </div>
                <div className="flex justify-between">
                  <span>Nama Staf:</span>
                  <span className="font-bold">{viewingSlip.staffName}</span>
                </div>
                <div className="flex justify-between">
                  <span>Role:</span>
                  <span>{viewingSlip.staffRole}</span>
                </div>
                <div className="flex justify-between">
                  <span>Periode:</span>
                  <span>{viewingSlip.periodMonth} ({viewingSlip.daysAttended} Hari)</span>
                </div>
              </div>

              <div className="text-[11px] space-y-1 border-b border-dashed border-slate-300 pb-2">
                <div className="font-bold text-[10px] uppercase text-slate-500">Pendapatan:</div>
                {viewingSlip.baseSalary > 0 && (
                  <div className="flex justify-between">
                    <span>Gaji Pokok</span>
                    <span>{formatRupiah(viewingSlip.baseSalary)}</span>
                  </div>
                )}
                {viewingSlip.allowance > 0 && (
                  <div className="flex justify-between">
                    <span>Uang Makan/Transp.</span>
                    <span>{formatRupiah(viewingSlip.allowance)}</span>
                  </div>
                )}
                {viewingSlip.individualCommission > 0 && (
                  <div className="flex justify-between font-bold text-emerald-700">
                    <span>Komisi Jasa/Retail</span>
                    <span>{formatRupiah(viewingSlip.individualCommission)}</span>
                  </div>
                )}
                {viewingSlip.teamPoolCommission > 0 && (
                  <div className="flex justify-between font-bold text-sky-700">
                    <span>Bagi Hasil Tim</span>
                    <span>{formatRupiah(viewingSlip.teamPoolCommission)}</span>
                  </div>
                )}
                {viewingSlip.dailyTargetBonus > 0 && (
                  <div className="flex justify-between font-bold text-amber-700">
                    <span>Bonus Target Harian</span>
                    <span>{formatRupiah(viewingSlip.dailyTargetBonus)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold pt-1 border-t border-slate-200">
                  <span>Total Kotor</span>
                  <span>{formatRupiah(viewingSlip.grossEarnings)}</span>
                </div>
              </div>

              {viewingSlip.deductions > 0 && (
                <div className="text-[11px] space-y-0.5 border-b border-dashed border-slate-300 pb-2 text-rose-600">
                  <div className="flex justify-between">
                    <span>Potongan / Kasbon</span>
                    <span>-{formatRupiah(viewingSlip.deductions)}</span>
                  </div>
                </div>
              )}

              <div className="text-center py-2 border-b border-dashed border-slate-300">
                <div className="text-[10px] text-slate-500 uppercase font-bold">Gaji Bersih Diterima:</div>
                <div className="text-lg font-black text-slate-900">{formatRupiah(viewingSlip.netSalary)}</div>
                <div className="text-[10px] mt-1 font-bold">
                  STATUS: {viewingSlip.status === 'PAID' ? 'LUNAS (SUDAH DIBAYAR)' : 'DRAFT (SIAP DICAIRKAN)'}
                </div>
              </div>

              {viewingSlip.notes && (
                <div className="text-[10px] text-slate-500 italic text-center">
                  Catatan: {viewingSlip.notes}
                </div>
              )}

              <div className="text-center text-[9px] text-slate-400 pt-1">
                Dicetak pada {formatDateTime(new Date())}
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleShareWhatsApp(viewingSlip)}
                className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>WhatsApp</span>
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Cetak Termal</span>
              </button>

              {viewingSlip.status !== 'PAID' && (
                <button
                  type="button"
                  onClick={() => handleDisbursePayroll(viewingSlip)}
                  className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
                >
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>Cairkan Kas</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
