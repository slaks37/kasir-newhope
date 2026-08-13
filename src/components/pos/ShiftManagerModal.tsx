import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { Shift } from '../../types';
import { formatRupiah, formatDateTime } from '../../utils/formatters';
import {
  Clock,
  X,
  UserCheck,
  DollarSign,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  XCircle,
  FileText,
  LogOut,
  Play,
  History,
  ShieldAlert,
  CreditCard,
  Building2,
  Calendar,
  Sparkles,
} from 'lucide-react';

interface ShiftManagerModalProps {
  onClose: () => void;
}

export const ShiftManagerModal: React.FC<ShiftManagerModalProps> = ({ onClose }) => {
  const { shift, shiftHistory, startShift, endShift, orders } = usePOS();

  const [activeTab, setActiveTab] = useState<'current' | 'history'>('current');

  // Start shift form state
  const [newCashierName, setNewCashierName] = useState('Kasir Bertugas');
  const [newInitialCash, setNewInitialCash] = useState<number>(500000);

  // End shift form state
  const [actualCashInput, setActualCashInput] = useState<string>(
    shift.expectedCash ? String(shift.expectedCash) : '0'
  );
  const [shiftNotes, setShiftNotes] = useState('');
  const [closingSuccessShift, setClosingSuccessShift] = useState<Shift | null>(null);

  const isShiftOpen = shift.status === 'OPEN';

  // Calculate current orders count for active shift
  const activeShiftOrdersCount = orders.filter(
    (o) => o.shiftId === shift.id && o.status === 'COMPLETED'
  ).length;

  const actualCashNum = parseFloat(actualCashInput) || 0;
  const differenceNum = actualCashNum - shift.expectedCash;

  const handleStartShiftSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCashierName.trim()) return;
    startShift(newCashierName.trim(), newInitialCash || 0);
  };

  const handleEndShiftSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const closed = endShift(actualCashNum, shiftNotes);
    setClosingSuccessShift(closed);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-3xl w-full text-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className={`p-2.5 rounded-2xl border ${
              isShiftOpen
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-600'
            }`}>
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-extrabold text-base sm:text-lg text-slate-900 leading-tight">
                  Manajemen Shift & Sesi Kasir
                </h3>
                <span
                  className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                    isShiftOpen
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-rose-100 text-rose-800 border border-rose-300'
                  }`}
                >
                  {isShiftOpen ? '● SHIFT AKTIF' : '○ SHIFT DITUTUP'}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Catat sesi masuk/keluar kasir, rekapitulasi modal uang laci, dan audit saldo kas.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-2xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-100/60 p-1.5 px-4 shrink-0 space-x-2">
          <button
            onClick={() => setActiveTab('current')}
            className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'current'
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <UserCheck className="w-4 h-4 text-amber-600" />
            <span>Sesi Shift Saja ({isShiftOpen ? 'Aktif' : 'Tutup'})</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'history'
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <History className="w-4 h-4 text-purple-600" />
            <span>Riwayat & Log Shift ({shiftHistory.length})</span>
          </button>
        </div>

        {/* Modal Main Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50/50">
          {activeTab === 'current' ? (
            closingSuccessShift ? (
              /* Success Closing View */
              <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-6 text-center space-y-4 animate-in zoom-in-95 duration-200">
                <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto border border-emerald-300">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <div>
                  <h4 className="font-extrabold text-lg text-emerald-950">
                    Shift Berhasil Ditutup!
                  </h4>
                  <p className="text-xs text-emerald-800">
                    Sesi kasir <strong className="font-bold">{closingSuccessShift.cashierName}</strong> telah diarsipkan ke laporan penutupan harian.
                  </p>
                </div>

                <div className="bg-white border border-emerald-200 rounded-2xl p-4 text-left text-xs space-y-2 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Kasir:</span>
                    <span className="font-bold text-slate-900">{closingSuccessShift.cashierName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Mulai Shift:</span>
                    <span className="text-slate-800">{formatDateTime(closingSuccessShift.startTime)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Selesai Shift:</span>
                    <span className="text-slate-800">{closingSuccessShift.endTime ? formatDateTime(closingSuccessShift.endTime) : '-'}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-100 pt-2">
                    <span className="text-slate-500">Total Transaksi:</span>
                    <span className="font-bold text-slate-900">{closingSuccessShift.totalOrders || 0} Order</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Omzet Sesi:</span>
                    <span className="font-extrabold text-amber-700">{formatRupiah(closingSuccessShift.totalSales)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Uang Laci Fisik (Actual):</span>
                    <span className="font-extrabold text-emerald-700">{formatRupiah(closingSuccessShift.actualCash || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Selisih Kas (Difference):</span>
                    <span className={`font-extrabold ${
                      (closingSuccessShift.difference || 0) === 0
                        ? 'text-emerald-700'
                        : (closingSuccessShift.difference || 0) > 0
                        ? 'text-blue-700'
                        : 'text-rose-700'
                    }`}>
                      {formatRupiah(closingSuccessShift.difference || 0)}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setClosingSuccessShift(null)}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl transition-all shadow-md"
                >
                  Mulai Shift Baru Atau Tutup Dialog
                </button>
              </div>
            ) : isShiftOpen ? (
              /* ACTIVE SHIFT VIEW */
              <div className="space-y-5">
                {/* Current Active Info Header */}
                <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs space-y-4">
                  <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-3 gap-2">
                    <div>
                      <span className="text-[10px] font-extrabold text-amber-800 uppercase tracking-wider block">
                        Kasir Bertugas Saat Ini
                      </span>
                      <h4 className="font-extrabold text-base text-slate-900">
                        {shift.cashierName}
                      </h4>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider block">
                        Waktu Mulai Shift
                      </span>
                      <span className="text-xs font-mono font-bold text-slate-800">
                        {formatDateTime(shift.startTime)}
                      </span>
                    </div>
                  </div>

                  {/* Realtime Session Metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                      <span className="text-[10px] text-slate-500 font-semibold block uppercase">
                        Modal Awal Uang Laci
                      </span>
                      <span className="font-mono font-extrabold text-slate-900 text-sm">
                        {formatRupiah(shift.initialCash)}
                      </span>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                      <span className="text-[10px] text-slate-500 font-semibold block uppercase">
                        Total Trx Selesai
                      </span>
                      <span className="font-mono font-extrabold text-slate-900 text-sm">
                        {activeShiftOrdersCount} Order
                      </span>
                    </div>

                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3">
                      <span className="text-[10px] text-amber-800 font-extrabold block uppercase">
                        Total Omzet Sesi Ini
                      </span>
                      <span className="font-mono font-extrabold text-amber-800 text-sm">
                        {formatRupiah(shift.totalSales)}
                      </span>
                    </div>

                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-3">
                      <span className="text-[10px] text-emerald-800 font-extrabold block uppercase">
                        Ekspektasi Kas Laci
                      </span>
                      <span className="font-mono font-extrabold text-emerald-800 text-sm">
                        {formatRupiah(shift.expectedCash)}
                      </span>
                    </div>
                  </div>

                  {/* Payment Breakdown */}
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2 text-xs">
                    <span className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wider block">
                      Rincian Metode Pembayaran Shift Ini:
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
                      <div className="bg-white p-2 rounded-xl border border-slate-200">
                        <span className="text-[10px] text-slate-500 block">Tunai (Cash):</span>
                        <strong className="text-slate-900">{formatRupiah(shift.cashSales)}</strong>
                      </div>
                      <div className="bg-white p-2 rounded-xl border border-slate-200">
                        <span className="text-[10px] text-slate-500 block">QRIS:</span>
                        <strong className="text-slate-900">{formatRupiah(shift.qrisSales)}</strong>
                      </div>
                      <div className="bg-white p-2 rounded-xl border border-slate-200">
                        <span className="text-[10px] text-slate-500 block">Kartu (EDC):</span>
                        <strong className="text-slate-900">{formatRupiah(shift.cardSales)}</strong>
                      </div>
                      <div className="bg-white p-2 rounded-xl border border-slate-200">
                        <span className="text-[10px] text-slate-500 block">E-Wallet:</span>
                        <strong className="text-slate-900">{formatRupiah(shift.eWalletSales)}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Form Akhiri Shift */}
                <form onSubmit={handleEndShiftSubmit} className="bg-white border border-rose-200 rounded-3xl p-5 shadow-xs space-y-4">
                  <div className="flex items-center space-x-2 text-rose-700">
                    <LogOut className="w-5 h-5 text-rose-600" />
                    <h4 className="font-extrabold text-base text-rose-950">
                      Form Penutupan / Akhiri Shift
                    </h4>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="block font-extrabold text-slate-800 mb-1">
                        Jumlah Uang Tunai Fisik di Laci Kasir (Rp):
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-extrabold text-slate-400">
                          Rp
                        </span>
                        <input
                          type="number"
                          value={actualCashInput}
                          onChange={(e) => setActualCashInput(e.target.value)}
                          placeholder="Masukkan total hitungan uang tunai laci..."
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-10 pr-4 py-2.5 font-mono text-sm text-slate-900 font-extrabold focus:outline-none focus:ring-2 focus:ring-amber-500"
                          required
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                        <span>Ekspektasi Uang Tunai Laci: <strong className="font-mono text-slate-800">{formatRupiah(shift.expectedCash)}</strong></span>
                        <button
                          type="button"
                          onClick={() => setActualCashInput(String(shift.expectedCash))}
                          className="text-amber-700 font-bold hover:underline"
                        >
                          Isi Otomatis (Sama)
                        </button>
                      </div>
                    </div>

                    {/* Variance Notice */}
                    <div className={`p-3 rounded-2xl border text-xs flex items-center justify-between font-mono ${
                      differenceNum === 0
                        ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                        : differenceNum > 0
                        ? 'bg-blue-50 text-blue-900 border-blue-200'
                        : 'bg-rose-50 text-rose-900 border-rose-200'
                    }`}>
                      <div>
                        <span className="text-[10px] uppercase font-bold block">Status Selisih Kas:</span>
                        <strong className="text-sm">
                          {differenceNum === 0
                            ? 'UANG KAS PAS (SESUAI)'
                            : differenceNum > 0
                            ? `LEBIH +${formatRupiah(differenceNum)}`
                            : `KURANG ${formatRupiah(differenceNum)}`}
                        </strong>
                      </div>
                      <ShieldAlert className="w-5 h-5 opacity-70" />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        Catatan Akhir Shift (Opsional):
                      </label>
                      <input
                        type="text"
                        value={shiftNotes}
                        onChange={(e) => setShiftNotes(e.target.value)}
                        placeholder="Contoh: Kasir berganti ke Rina, selisih Rp 0..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-2"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Akhiri Shift Kasir Sekarang</span>
                  </button>
                </form>
              </div>
            ) : (
              /* CLOSED SHIFT VIEW - START SHIFT FORM */
              <div className="space-y-5">
                <div className="bg-slate-100/80 border border-slate-200 rounded-3xl p-6 text-center space-y-2">
                  <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto border border-rose-200">
                    <XCircle className="w-6 h-6" />
                  </div>
                  <h4 className="font-extrabold text-slate-900 text-base">
                    Belum Ada Shift Kasir Aktif
                  </h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Mulaikan shift kasir baru untuk mencatat transaksi penjualan, memperhitungkan modal uang laci, dan melacak aktivitas sesi kasir.
                  </p>
                </div>

                <form onSubmit={handleStartShiftSubmit} className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
                  <div className="flex items-center space-x-2 text-amber-700">
                    <Play className="w-5 h-5 fill-amber-500 text-amber-600" />
                    <h4 className="font-extrabold text-base text-slate-900">
                      Form Mulai Shift Baru
                    </h4>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        Nama Kasir Bertugas:
                      </label>
                      <input
                        type="text"
                        value={newCashierName}
                        onChange={(e) => setNewCashierName(e.target.value)}
                        placeholder="Masukkan nama kasir (contoh: Ahmad Kasir)..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        Modal Uang Kasir Awal / Laci (Rp):
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-extrabold text-slate-400">
                          Rp
                        </span>
                        <input
                          type="number"
                          value={newInitialCash}
                          onChange={(e) => setNewInitialCash(parseFloat(e.target.value) || 0)}
                          placeholder="500000"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 font-mono text-xs font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          required
                        />
                      </div>
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        Uang kembalian awal yang dimasukkan ke laci meja kasir.
                      </span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-2"
                  >
                    <Play className="w-4 h-4 fill-white" />
                    <span>Mulai Shift Kasir Sekarang</span>
                  </button>
                </form>
              </div>
            )
          ) : (
            /* TAB 2: SHIFT HISTORY LOGS */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-extrabold text-xs text-slate-700 uppercase tracking-wider">
                  Log Aktivitas & Riwayat Sesi Shift
                </h4>
                <span className="text-xs text-slate-500 font-mono">
                  Total {shiftHistory.length} Sesi Terarsip
                </span>
              </div>

              {shiftHistory.length === 0 ? (
                <div className="text-center py-10 text-slate-400 space-y-2">
                  <History className="w-10 h-10 mx-auto text-slate-300 stroke-1" />
                  <p className="text-xs font-bold text-slate-600">Belum Ada Riwayat Shift Terarsip</p>
                </div>
              ) : (
                shiftHistory.map((s) => (
                  <div
                    key={s.id}
                    className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2.5 shadow-2xs hover:border-amber-300 transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-2 text-xs gap-2">
                      <div className="flex items-center space-x-2">
                        <span className="font-extrabold text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200">
                          {s.cashierName}
                        </span>
                        <span className="text-slate-500 font-mono text-[11px]">
                          {s.id}
                        </span>
                      </div>

                      <span
                        className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md ${
                          s.status === 'OPEN'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans">Mulai:</span>
                        <span className="text-slate-800 font-medium">{formatDateTime(s.startTime)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans">Selesai:</span>
                        <span className="text-slate-800 font-medium">{s.endTime ? formatDateTime(s.endTime) : 'Aktif'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans">Omzet Sesi:</span>
                        <strong className="text-amber-800">{formatRupiah(s.totalSales)}</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans">Selisih Kas:</span>
                        <strong className={`${(s.difference || 0) === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {formatRupiah(s.difference || 0)}
                        </strong>
                      </div>
                    </div>

                    {s.notes && (
                      <p className="text-[11px] text-slate-500 italic bg-slate-50 p-2 rounded-xl border border-slate-100">
                        Catatan: {s.notes}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
